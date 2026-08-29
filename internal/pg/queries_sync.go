package pg

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgcm/pgcm/internal/model"
)

// querySyncMatrix 统计每个 subscription 的同步状态机分布。
// pg_subscription_rel.srsubstate 是单字符状态码：
//   'i' = INIT,  'd' = DATA, 'f' = FINISHED, 's' = SYNCED,
//   'r' = READY (apply 准备就绪), NULL 表示没有表行。
//
// 输出按 (subname, srsubstate) 一行，前端用 subname 分组绘制矩阵。
func querySyncMatrix(ctx context.Context, pool *pgxpool.Pool) ([]model.SyncMatrixCell, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.subname,
		       sr.srsubstate,
		       count(*)::int AS table_count,
		       max(sr.srsublsn)::text AS oldest_state_lsn
		FROM pg_subscription s
		LEFT JOIN pg_subscription_rel sr ON sr.srsubid = s.oid
		GROUP BY s.subname, sr.srsubstate
		ORDER BY s.subname, sr.srsubstate
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []model.SyncMatrixCell{}
	for rows.Next() {
		var c model.SyncMatrixCell
		var state *string
		if err := rows.Scan(&c.SubName, &state, &c.TableCount, &c.OldestLSN); err != nil {
			return nil, err
		}
		if state != nil {
			c.SRSubState = *state
			c.StateName = stateName(*state)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func stateName(c string) string {
	switch c {
	case "i":
		return "INIT"
	case "d":
		return "DATA"
	case "f":
		return "FINISHED"
	case "s":
		return "SYNCED"
	case "r":
		return "READY"
	default:
		return "?"
	}
}
