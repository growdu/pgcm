package pg

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgcm/pgcm/internal/model"
	"github.com/pgcm/pgcm/internal/store"
)

// BuildSnapshot 一次聚合：跑 SQL §1 + §2 (diff) + §5 + §6 + §8 + §9，返回 Snapshot。
func (c *Conns) BuildSnapshot(
	ctx context.Context,
	node *store.Node,
	r *store.Ring,
) (model.Snapshot, error) {
	pool, ok := c.Pool(node.ID)
	if !ok {
		return model.Snapshot{}, fmt.Errorf("no pool for node %s", node.ID)
	}
	snap := model.Snapshot{
		TakenAt:   time.Now().UTC().Format(time.RFC3339),
		NodeID:    node.ID,
		NodeName:  node.Name,
		PGVersion: node.NodeConfig.PGVersion,
		Slots:     []model.SlotHealth{},
	}

	// 错误聚合器（每个 sub 一行）
	errBySub := map[string]*model.ErrorStat{}

	// 逻辑复制
	if node.ClusterKind == "logical" || node.ClusterKind == "hybrid" {
		logical, err := buildLogical(ctx, pool, r, errBySub)
		if err != nil {
			return snap, fmt.Errorf("logical: %w", err)
		}
		snap.Logical = logical
	}

	// 物理复制
	if node.ClusterKind == "physical" || node.ClusterKind == "hybrid" {
		physical, err := buildPhysical(ctx, pool)
		if err != nil {
			return snap, fmt.Errorf("physical: %w", err)
		}
		snap.Physical = physical
	}

	// slot 健康（所有 slot 都查）
	slots, err := buildSlotHealth(ctx, pool)
	if err != nil {
		return snap, fmt.Errorf("slots: %w", err)
	}
	snap.Slots = slots

	// errors 收尾
	if snap.Logical != nil {
		for _, e := range errBySub {
			snap.Logical.Errors = append(snap.Logical.Errors, *e)
		}
	}

	node.Touch()
	return snap, nil
}

// buildLogical 订阅表 + worker + spill (diff)。
func buildLogical(ctx context.Context, pool *pgxpool.Pool, r *store.Ring, errBySub map[string]*model.ErrorStat) (*model.LogicalPanel, error) {
	panel := &model.LogicalPanel{
		Subscriptions: []model.SubscriptionSummary{},
		Workers:       []model.WorkerStat{},
		SyncMatrix:    []model.SyncMatrixCell{},
		Errors:        []model.ErrorStat{},
		SpillStats:    []model.SpillStat{},
	}

	// 1) 订阅表主查询（脚本 §1 的子集，单连接版本）
	subs, err := querySubscriptions(ctx, pool)
	if err != nil {
		return nil, err
	}

	// 2) pg_stat_replication_slots 当前值（差分用）
	slotCounters, err := queryReplicationSlotCounters(ctx, pool)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	sample := store.Sample{TS: now, Values: map[string]int64{}}
	for slotName, m := range slotCounters {
		sample.Values[slotName+".spill_bytes"] = m["spill_bytes"]
		sample.Values[slotName+".stream_bytes"] = m["stream_bytes"]
		sample.Values[slotName+".total_bytes"] = m["total_bytes"]
		sample.Values[slotName+".spill_txns"] = m["spill_txns"]
		sample.Values[slotName+".stream_txns"] = m["stream_txns"]
		sample.Values[slotName+".total_txns"] = m["total_txns"]
		sample.Values[slotName+".spill_count"] = m["spill_count"]
		sample.Values[slotName+".stream_count"] = m["stream_count"]
	}
	r.Push(sample)

	// 计算差分：每个 slot → 当前 vs 5min 前
	diffs := map[string]*model.SpillStat{}
	if oldest, ok := r.Oldest(now); ok {
		for slotName := range slotCounters {
			cur := slotCounters[slotName]
			winSec := now.Sub(oldest.TS).Seconds()
			if winSec < 1 {
				winSec = 1
			}
			get := func(key string) int64 {
				if oldest.Values == nil {
					return 0
				}
				return oldest.Values[slotName+"."+key]
			}
			dTotalB := cur["total_bytes"] - get("total_bytes")
			dTotalT := cur["total_txns"] - get("total_txns")
			dSpillB := cur["spill_bytes"] - get("spill_bytes")
			dSpillC := cur["spill_count"] - get("spill_count")
			dSpillT := cur["spill_txns"] - get("spill_txns")
			dStreamB := cur["stream_bytes"] - get("stream_bytes")
			dStreamC := cur["stream_count"] - get("stream_count")
			dStreamT := cur["stream_txns"] - get("stream_txns")

			spillPct := 0.0
			if dTotalB > 0 {
				spillPct = float64(dSpillB) / float64(dTotalB) * 100
			}
			ratio := 0.0
			if dSpillT > 0 {
				ratio = float64(dStreamT) / float64(dSpillT)
			}
			avgSpill := ""
			if dSpillC > 0 {
				avgSpill = formatBytes(dSpillB / dSpillC)
			} else {
				avgSpill = "0 bytes"
			}
			diffs[slotName] = &model.SpillStat{
				SlotName:          slotName,
				SpillBytes:        dSpillB,
				SpillCount:        dSpillC,
				SpillTxns:         dSpillT,
				StreamBytes:       dStreamB,
				StreamCount:       dStreamC,
				StreamTxns:        dStreamT,
				TotalBytes:        dTotalB,
				TotalTxns:         dTotalT,
				SpillPct:          spillPct,
				StreamToSpillRatio: ratio,
				AvgSpillSize:      avgSpill,
				WindowSeconds:     winSec,
			}
		}
	}

	// 把 spill / rate 信息附到每个 sub；按 slot_name
	// 同时把 errors 累到 errBySub
	for i, sub := range subs {
		if d, ok := diffs[sub.SlotName]; ok {
			sub.SpillPct = d.SpillPct
			if d.WindowSeconds > 0 {
				sub.TotalMbps = float64(d.TotalBytes) / 1024 / 1024 / d.WindowSeconds
			}
		}
		sub.Severity = severityOf(sub)
		subs[i] = sub

		es := errBySub[sub.SubName]
		if es == nil {
			es = &model.ErrorStat{SubName: sub.SubName}
			errBySub[sub.SubName] = es
		}
		es.ApplyErrorCount = sub.ApplyErrorCount
		es.ConflInsertExists = sub.ConflictCounts["confl_insert_exists"]
		es.ConflUpdateExists = sub.ConflictCounts["confl_update_exists"]
		es.ConflDeleteMissing = sub.ConflictCounts["confl_delete_missing"]
		es.ConflMultipleUnique = sub.ConflictCounts["confl_multiple_unique_conflicts"]
		es.ConflUpdateMissing = sub.ConflictCounts["confl_update_missing"]
	}

	panel.Subscriptions = subs
	panel.SpillStats = spillList(diffs)

	// 汇总速率
	var totalMbps, totalTps, spillMbps, streamMbps float64
	for _, d := range diffs {
		if d.WindowSeconds > 0 {
			totalMbps += float64(d.TotalBytes) / 1024 / 1024 / d.WindowSeconds
			totalTps += float64(d.TotalTxns) / d.WindowSeconds
			spillMbps += float64(d.SpillBytes) / 1024 / 1024 / d.WindowSeconds
			streamMbps += float64(d.StreamBytes) / 1024 / 1024 / d.WindowSeconds
		}
	}
	panel.Rates = model.RateStats{
		TotalMbps: totalMbps, TotalTps: totalTps,
		SpillMbps: spillMbps, StreamMbps: streamMbps,
	}

	// workers（脚本 §5）
	workers, err := queryWorkers(ctx, pool)
	if err != nil {
		return nil, err
	}
	panel.Workers = workers

	// sync matrix（脚本 §4）— 失败不致命：subscriber 端 pg_subscription_rel 可能为空。
	matrix, err := querySyncMatrix(ctx, pool)
	if err != nil {
		// 保留空矩阵，不让整次 tick 失败
		matrix = []model.SyncMatrixCell{}
	}
	panel.SyncMatrix = matrix

	return panel, nil
}

func spillList(m map[string]*model.SpillStat) []model.SpillStat {
	out := make([]model.SpillStat, 0, len(m))
	for _, v := range m {
		out = append(out, *v)
	}
	return out
}

func buildPhysical(ctx context.Context, pool *pgxpool.Pool) (*model.PhysicalPanel, error) {
	replicas, err := queryReplicas(ctx, pool)
	if err != nil {
		return nil, err
	}
	return &model.PhysicalPanel{Replicas: replicas}, nil
}

func buildSlotHealth(ctx context.Context, pool *pgxpool.Pool) ([]model.SlotHealth, error) {
	return querySlotHealth(ctx, pool)
}

// formatBytes 把字节数转人类可读。
func formatBytes(b int64) string {
	const (
		kB = 1024
		mB = kB * 1024
		gB = mB * 1024
		tB = gB * 1024
	)
	switch {
	case b < kB:
		return fmt.Sprintf("%d B", b)
	case b < mB:
		return fmt.Sprintf("%d kB", b/kB)
	case b < gB:
		return fmt.Sprintf("%d MB", b/mB)
	case b < tB:
		return fmt.Sprintf("%.2f GB", float64(b)/float64(gB))
	default:
		return fmt.Sprintf("%.2f TB", float64(b)/float64(tB))
	}
}
