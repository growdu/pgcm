// Package store 提供节点注册表与滚动窗口（内存）。
package store

import (
	"sync"
	"time"
)

// Sample 一个时间点上的样本（用于差分）。
type Sample struct {
	TS      time.Time
	Values  map[string]int64 // slot_name → counter
}

// Ring 通用滚动窗口（按时间倒序保留最近 Window 时长内、BucketSec 一桶）。
type Ring struct {
	mu        sync.RWMutex
	bucketSec int
	window    time.Duration
	buckets   []Sample // 旧→新
}

// NewRing 创建滚动窗口。
func NewRing(window time.Duration, bucketSec int) *Ring {
	if bucketSec <= 0 {
		bucketSec = 30
	}
	if window <= 0 {
		window = 5 * time.Minute
	}
	return &Ring{
		bucketSec: bucketSec,
		window:    window,
	}
}

// Push 推一个新样本。返回是否实际新增了一桶（即桶号变化）。
func (r *Ring) Push(s Sample) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := s.TS
	if now.IsZero() {
		now = time.Now()
	}
	lastBucket := now.Truncate(time.Duration(r.bucketSec) * time.Second)
	if n := len(r.buckets); n > 0 && r.buckets[n-1].TS.Equal(lastBucket) {
		// 同一桶：合并 Values
		for k, v := range s.Values {
			r.buckets[n-1].Values[k] = v
		}
		return false
	}
	s.TS = lastBucket
	if s.Values == nil {
		s.Values = map[string]int64{}
	}
	r.buckets = append(r.buckets, s)
	// 删除超过 window 的旧桶
	cutoff := now.Add(-r.window)
	for len(r.buckets) > 0 && r.buckets[0].TS.Before(cutoff) {
		r.buckets = r.buckets[1:]
	}
	return true
}

// Oldest returns window 之前的最近一桶；如果没有则返回 false。
func (r *Ring) Oldest(now time.Time) (Sample, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.buckets) == 0 {
		return Sample{}, false
	}
	return r.buckets[0], true
}

// Newest returns 最新一桶。
func (r *Ring) Newest() (Sample, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.buckets) == 0 {
		return Sample{}, false
	}
	return r.buckets[len(r.buckets)-1], true
}

// Snapshot returns 全部当前桶的快照（按时间排序）。
func (r *Ring) Snapshot() []Sample {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Sample, len(r.buckets))
	copy(out, r.buckets)
	return out
}

// Len 当前桶数。
func (r *Ring) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.buckets)
}
