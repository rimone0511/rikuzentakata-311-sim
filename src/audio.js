// あの日の「情報環境」の再現(恐怖演出ではない)。
// すべて Web Audio API による合成音。外部音声ファイルは使用しない。
// 音量は控えめに。ホラー的な演出音・BGM・効果音は一切禁止。

// 防災無線チャイム(「ピーンポーンパーンポーン」風)の音階。
// サイン波 4音、各 0.6秒、2回繰り返す。
const CHIME_NOTES = [
  { freq: 659.25, dur: 0.6 }, // E5
  { freq: 523.25, dur: 0.6 }, // C5
  { freq: 587.33, dur: 0.6 }, // D5
  { freq: 392.00, dur: 0.6 }, // G4
];
const CHIME_REPEATS = 2;
const CHIME_GAP = 0.25; // 音同士の間隔
const CHIME_REPEAT_GAP = 1.0; // 繰り返し間の間隔

// チャイムを発火させる simTime のしきい値(秒)。1回だけスケジュールする。
const CHIME_TIMES = [180, 1680];

// サイレンの長さ・音階スイープ周期
const SIREN_DURATION = 30; // 秒
const SIREN_SWEEP_PERIOD = 4; // 秒(400Hz⇔800Hz を往復する周期)
const SIREN_LOW = 400;
const SIREN_HIGH = 800;

// 地鳴り・揺れの音の継続時間
const RUMBLE_DURATION = 180; // 秒

export class SimAudio {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._muted = false;

    // マスターゲイン(ミュート切り替え用。クリックノイズ回避のため setTargetAtTime を使う)
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    // ---- 地鳴り・揺れの音(ブラウンノイズ+ローパス) ----
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleGain.connect(this.master);
    this._rumbleNode = this.#createBrownNoiseSource();
    const rumbleLpf = this.ctx.createBiquadFilter();
    rumbleLpf.type = 'lowpass';
    rumbleLpf.frequency.value = 80;
    this._rumbleNode.connect(rumbleLpf);
    rumbleLpf.connect(this.rumbleGain);
    this._rumbleNode.start();

    // ---- 波・水の音(ホワイトノイズ+バンドパス) ----
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0;
    this.waterGain.connect(this.master);
    this._waterNode = this.#createWhiteNoiseSource();
    const waterBpf = this.ctx.createBiquadFilter();
    waterBpf.type = 'bandpass';
    waterBpf.frequency.value = 220;
    waterBpf.Q.value = 0.6;
    this._waterNode.connect(waterBpf);
    waterBpf.connect(this.waterGain);
    this._waterNode.start();

    // ---- サイレン(発火時に生成・停止する単発ノード。現在鳴っているものを保持) ----
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenGain.connect(this.master);
    this._sirenActiveNode = null;
    this._sirenActiveUntilSimTime = -Infinity; // このsimTimeまでサイレンが鳴っている想定

    // ---- チャイム用ゲイン(音量小さめ+ローパスで「遠くのスピーカー風」) ----
    this.chimeGain = this.ctx.createGain();
    this.chimeGain.gain.value = 0.35;
    const chimeLpf = this.ctx.createBiquadFilter();
    chimeLpf.type = 'lowpass';
    chimeLpf.frequency.value = 2200;
    this.chimeGain.connect(chimeLpf);
    chimeLpf.connect(this.master);

    // 既に発火済みのチャイム時刻(倍速時に跨いだかどうかで判定するため)
    this._firedChimeTimes = new Set();
    // 前フレームの simTime(しきい値を跨いだかの判定に使う)
    this._lastSimTime = -Infinity;

    // サイレン鳴動中の開始 simTime を記録(CHIME_TIMES に対応。要素数は同じ)
    this._sirenStartSimTime = null;
  }

  // ユーザー操作後に呼ぶ。AudioContext を再開する。
  start() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this._muted = muted;
    const target = muted ? 0 : 1;
    // クリックノイズを避けるため急激な値変更でなく setTargetAtTime を使う
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  get muted() {
    return this._muted;
  }

  // 毎フレーム呼ばれる。
  // simTime: 地震(14:46)からの経過秒
  // waterInfo: { nearestDepth: プレイヤー周辺の浸水深(m、負なら未浸水), coastLevel: 沿岸水位(m) }
  update(simTime, waterInfo) {
    const now = this.ctx.currentTime;

    // --- 1. 地鳴り・揺れの音 ---
    // 最初の30秒が最大、180秒にかけてフェードアウト
    let rumbleTarget = 0;
    if (simTime >= 0 && simTime < RUMBLE_DURATION) {
      const RUMBLE_PEAK = 0.30;
      if (simTime < 30) {
        rumbleTarget = RUMBLE_PEAK;
      } else {
        const fadeProgress = (simTime - 30) / (RUMBLE_DURATION - 30); // 0→1
        rumbleTarget = RUMBLE_PEAK * Math.max(0, 1 - fadeProgress);
      }
    }
    this.rumbleGain.gain.setTargetAtTime(rumbleTarget, now, 0.3);

    // --- 2. 防災無線チャイム + 3. サイレン ---
    // simTime がしきい値を跨いだ瞬間に1回だけスケジュールする(倍速再生に対応)。
    for (const threshold of CHIME_TIMES) {
      if (!this._firedChimeTimes.has(threshold) &&
          this._lastSimTime < threshold && simTime >= threshold) {
        this._firedChimeTimes.add(threshold);
        this.#scheduleChimeAndSiren();
      }
    }

    // サイレンの音量制御(発火から SIREN_DURATION 秒だけ鳴らす)。
    // 実時間スケジュールではなく、simTime ベースで on/off を判定する。
    let sirenActive = false;
    for (const threshold of CHIME_TIMES) {
      if (this._firedChimeTimes.has(threshold)) {
        const chimeTotalDur =
          CHIME_NOTES.reduce((s, n) => s + n.dur + CHIME_GAP, 0) * CHIME_REPEATS +
          CHIME_REPEAT_GAP;
        const sirenStart = threshold + chimeTotalDur;
        const sirenEnd = sirenStart + SIREN_DURATION;
        if (simTime >= sirenStart && simTime < sirenEnd) {
          sirenActive = true;
          this.#updateSirenSweep(simTime - sirenStart);
        }
      }
    }
    this.sirenGain.gain.setTargetAtTime(sirenActive ? 0.12 : 0, now, 0.2);
    if (!sirenActive) {
      this.#stopSirenNode();
    }

    // --- 4. 波・水の音 ---
    let waterTarget = 0;
    if (waterInfo && waterInfo.coastLevel > 2) {
      const depth = waterInfo.nearestDepth;
      if (depth >= -5) {
        // depth < -5 ならほぼ無音。depth が大きいほど(近い・深いほど)音量を上げる。
        // -5〜0: 遠いながら次第に聞こえてくる、0以上: 浸水中でさらに大きく。控えめに最大でも0.25程度。
        const norm = Math.min(Math.max((depth + 5) / 8, 0), 1); // -5→0, 3→1 あたりで飽和
        waterTarget = 0.05 + norm * 0.20;
      }
    }
    this.waterGain.gain.setTargetAtTime(waterTarget, now, 0.5);

    this._lastSimTime = simTime;
  }

  // ブラウンノイズ音源を作成(地鳴り用)
  #createBrownNoiseSource() {
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // ブラウンノイズ: 積分(低域が強調される)して正規化
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  // ホワイトノイズ音源を作成(波の音用)
  #createWhiteNoiseSource() {
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  // チャイム(4音×2回)をスケジュールする。サイレンはこの後に update() 側の
  // simTime 判定で鳴動区間を計算するので、ここではチャイム音のみ発音する。
  #scheduleChimeAndSiren() {
    const now = this.ctx.currentTime;
    let t = now;
    for (let rep = 0; rep < CHIME_REPEATS; rep++) {
      for (const note of CHIME_NOTES) {
        this.#scheduleTone(t, note.freq, note.dur);
        t += note.dur + CHIME_GAP;
      }
      t += CHIME_REPEAT_GAP;
    }
  }

  // サイン波1音を指定の実時間オフセットで鳴らす(チャイム用)
  #scheduleTone(startTime, freq, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(this.chimeGain);

    // 短いアタック・リリースでクリックノイズを避ける
    const attack = 0.03;
    const release = 0.15;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(1, startTime + attack);
    g.gain.setValueAtTime(1, Math.max(startTime + attack, startTime + dur - release));
    g.gain.linearRampToValueAtTime(0, startTime + dur);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  // サイレンの周波数を simTime ベースのオフセットからスイープさせる。
  // ノードが無ければ生成し、以後は周波数だけ更新する(毎フレーム生成しない)。
  #updateSirenSweep(elapsed) {
    if (!this._sirenActiveNode) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.connect(this.sirenGain);
      osc.start();
      this._sirenActiveNode = osc;
    }
    // 0〜1: 三角波状に SIREN_LOW〜SIREN_HIGH を往復
    const phase = (elapsed % SIREN_SWEEP_PERIOD) / SIREN_SWEEP_PERIOD; // 0〜1
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0→1→0
    const freq = SIREN_LOW + (SIREN_HIGH - SIREN_LOW) * tri;
    this._sirenActiveNode.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
  }

  #stopSirenNode() {
    if (this._sirenActiveNode) {
      try {
        this._sirenActiveNode.stop();
      } catch (e) {
        // 既に停止済みの場合は無視
      }
      this._sirenActiveNode.disconnect();
      this._sirenActiveNode = null;
    }
  }
}
