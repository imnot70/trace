#!/usr/bin/env python3
"""
复古打字机原型音色合成（离线原型，未接入应用）。
依据本目录的频谱分析（analysis.txt / events.csv / modes.csv / third_octave.csv）重建：
  - 事件时间轴与响度：events.csv 的 8 次击键（起振 / 峰值 dBFS / 攻击时间 / 谱重心）
  - 共振模态：modes.csv 的 14 个模态（频率 / 相对电平），高频模态余振更长
    （分析 §5：最响事件 2-9kHz 段 -20dB 衰减 293ms，为金属余振）
  - 立体声：L 比 R 响 ~4dB，高频侧向能量多（§6）——噪声击打双通道独立、模态层居中
运行：python3 synthesize_prototype.py  → 输出 prototype_v1.wav（同目录）
"""
import wave
import numpy as np

SR = 44100
DUR = 1.7
N = int(SR * DUR)
rng = np.random.default_rng(20260927)

# ---- 共振模态（modes.csv：频率 Hz, 相对 dB → 线性）----
MODES_DB = [
    (11447.5, 0.0), (6528.8, -3.8), (252.4, -5.5), (2743.4, -10.9),
    (17584.3, -16.9), (749.0, -13.5), (4175.5, -17.5), (1284.8, -16.0),
    (3344.4, -18.9), (5670.8, -19.0), (1459.1, -17.0), (5872.9, -19.3),
    (4595.2, -19.5), (520.1, -16.5),
]
# 注：低频模态（252/520/749/1284/1459）在 LTAS 比对后增强 ~3dB（原型首版低频偏薄）
MODES = [(f, 10 ** (db / 20)) for f, db in MODES_DB]

# ---- 事件表（events.csv：起振, 峰值线性, 谱重心, 攻击 10-90% ms, -20dB 衰减 ms, 特征）----
EVENTS = [
    (0.136, 10 ** (-17.66 / 20), 901, 3.63, 0.017, 'key_soft'),
    (0.506, 10 ** (-13.94 / 20), 3551, 2.54, 0.007, 'key'),
    (0.554, 10 ** (-12.27 / 20), 7448, 6.19, 0.097, 'ratchet'),
    (0.712, 10 ** (-14.31 / 20), 2388, 4.06, 0.020, 'key'),
    (0.760, 10 ** (-9.31 / 20), 4661, 0.59, 0.006, 'key_bright'),
    (0.834, 10 ** (-7.87 / 20), 6498, 0.36, 0.045, 'key_bright'),
    (0.914, 10 ** (-6.40 / 20), 10150, 1.90, 0.121, 'return_bell'),
    (1.328, 10 ** (-12.92 / 20), 1781, 0.34, 0.168, 'thud'),
]

def noise_click(dur_s, centroid_hz, rng):
    """击打瞬态：白噪爆发 → 一阶低通（卷积指数核近似），截止频率跟随谱重心。"""
    n = max(8, int(SR * dur_s))
    x = rng.standard_normal(n)
    fc = float(np.clip(centroid_hz * 1.2, 900, 13000))
    tau = SR / (2 * np.pi * fc)  # 一阶低通时间常数（采样点）
    kernel = np.exp(-np.arange(int(tau * 6)) / tau)
    y = np.convolve(x, kernel)[:n]
    return y / (np.abs(y).max() + 1e-9)

def modal_ring(dur_s, centroid_hz, rng, ring_tau, subpeaks=()):
    """模态余振：modes.csv 的模态叠加，激励权重随谱重心偏移（亮事件激励高频模态多）。
    ring_tau：高频金属模态的衰减时间常数（秒）。subpeaks：二次击打时刻（秒，相对），小幅再激励。"""
    n = max(8, int(SR * dur_s))
    t = np.arange(n) / SR
    b = float(np.clip((centroid_hz - 1000) / 9000, 0, 1))  # 亮度 0..1
    out = np.zeros(n)
    for f, a in MODES:
        hi = f > 1000
        weight = (0.3 + 0.7 * b) if hi else (1 - 0.5 * b)
        tau = ring_tau if hi else ring_tau * 0.3  # 低频模态衰减快
        out += a * weight * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    for tp, ta in subpeaks:
        i = int(tp * SR)
        if i < n:
            out[i:] += out[:n - i] * ta
    out /= (np.abs(out).max() + 1e-9)
    return out

def render_event(t0, peak, centroid, attack_ms, decay20_ms, kind):
    start = int(t0 * SR)
    seg_len = 0.42 if kind in ('return_bell', 'thud') else 0.24
    n = int(SR * seg_len)
    t = np.arange(n) / SR
    ring_tau = max(0.02, decay20_ms / 1000 / 2.303)
    sub = ()
    if kind == 'ratchet':
        sub = tuple((x / 1000, 0.5) for x in (21, 32, 42, 57, 68, 82, 155))
    if kind == 'return_bell':
        sub = tuple((x / 1000, 0.45) for x in (27, 39, 50, 62, 81))
    click = noise_click(min(0.05, max(0.012, decay20_ms * 3 / 1000)), centroid, rng)
    click = np.pad(click, (0, n - len(click)))[:n]
    ring = modal_ring(n / SR, centroid, rng, ring_tau * (1.6 if kind == 'return_bell' else 1.0), sub)
    # 包络：快攻击（10-90% 线性映射到全幅 ~1.5×）+ 指数衰减
    atk = np.clip(t / (attack_ms / 1000 * 1.5), 0, 1)
    env = atk * np.exp(-t / max(0.004, decay20_ms / 1000 / 2.303))
    body = (click * 0.6 + ring * 0.8) * env
    out = np.zeros(N)
    out[start:start + n] += body[:max(0, min(n, N - start))] * peak
    return out

L = np.zeros(N)
R = np.zeros(N)
for t0, peak, centroid, atk, d20, kind in EVENTS:
    eL = render_event(t0, peak, centroid, atk, d20, kind)
    # 模态层居中、噪声击打双通道独立（§6：高频侧向能量多）
    eR = render_event(t0, peak, centroid, atk, d20, kind) if kind in ('key', 'key_soft') else eL
    L += eL
    R += eR * 0.78  # §1：R 峰值约 L 的 0.78

L *= 0.82 / (np.abs(L).max() + 1e-9)   # 对齐参考峰值 -1.7 dBFS
R *= 0.66 / (max(np.abs(R).max(), 1e-9))

data = np.stack([L, R], axis=1)
pcm = np.round(np.clip(data, -1, 1) * 32767).astype(np.int16)

buf = pcm.tobytes()
with wave.open('prototype_v1.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(buf)
print(f'prototype_v1.wav：{len(pcm)/SR:.3f}s，峰值 {np.abs(data).max():.3f}')
