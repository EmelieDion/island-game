export const createAudio = () => {
  let context = null;
  let master = null;
  let noise = null;
  let rainGain = null;
  let windGain = null;
  let windFilter = null;
  let wavesGain = null;
  let fireGain = null;
  let fireLevel = 0;
  let muted = false;
  let lastThud = 0;

  const createNoise = () => {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const loop = (filterType, frequency, q) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(master);
    source.start();
    return { filter, gain };
  };

  const start = () => {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(context.destination);
    noise = createNoise();

    wavesGain = loop('lowpass', 380, 0.7).gain;
    rainGain = loop('highpass', 1800, 0.5).gain;
    const wind = loop('bandpass', 500, 1.2);
    windGain = wind.gain;
    windFilter = wind.filter;
    fireGain = loop('bandpass', 1100, 0.8).gain;
  };

  const burst = ({ type, from, to = from, duration, volume, q = 1, delay = 0 }) => {
    if (!context) return;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.05, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now, Math.random());
    source.stop(now + duration + 0.05);
  };

  const tone = ({ from, to, duration, volume, type = 'sine' }) => {
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  };

  const thunder = () => {
    burst({ type: 'highpass', from: 2500, duration: 0.25, volume: 0.6 });
    burst({ type: 'lowpass', from: 900, to: 120, duration: 2.8, volume: 0.9, delay: 0.05 });
    burst({ type: 'lowpass', from: 300, to: 60, duration: 3.5, volume: 0.6, delay: 0.3 });
  };

  const whoosh = (strength = 1) => {
    burst({ type: 'bandpass', from: 250, to: 1400, duration: 0.8, volume: 0.35 * strength, q: 1.5 });
  };

  const thud = (strength) => {
    if (!context || context.currentTime - lastThud < 0.06) return;
    lastThud = context.currentTime;
    const volume = Math.min(0.6, strength * 0.03);
    tone({ from: 140, to: 45, duration: 0.25, volume });
    burst({ type: 'lowpass', from: 1500, to: 300, duration: 0.15, volume: volume * 0.6 });
  };

  const rewind = () => {
    tone({ from: 900, to: 160, duration: 0.6, volume: 0.15, type: 'triangle' });
    burst({ type: 'bandpass', from: 2000, to: 300, duration: 0.9, volume: 0.2, q: 2 });
  };

  const hiss = () => {
    burst({ type: 'highpass', from: 3000, to: 6000, duration: 2.2, volume: 0.35 });
  };

  const setFire = (level) => {
    fireLevel = level;
  };

  const update = (rain, wind, elapsedTime) => {
    if (!context) return;
    const now = context.currentTime;
    fireGain.gain.setTargetAtTime(fireLevel * (0.08 + Math.random() * 0.22), now, 0.015);
    if (fireLevel > 0.05 && Math.random() < fireLevel * 0.08) {
      burst({ type: 'highpass', from: 2500, duration: 0.04 + Math.random() * 0.05, volume: 0.1 + fireLevel * 0.15 });
    }
    const swell = 0.08 + Math.sin(elapsedTime * 0.7) * 0.03 + wind * 0.08;
    wavesGain.gain.setTargetAtTime(swell, now, 0.3);
    rainGain.gain.setTargetAtTime(rain * 0.25, now, 0.3);
    windGain.gain.setTargetAtTime(wind * wind * 0.35, now, 0.3);
    windFilter.frequency.setTargetAtTime(350 + wind * 500 + Math.sin(elapsedTime * 1.3) * 150, now, 0.3);
  };

  const toggleMute = () => {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, context.currentTime, 0.05);
    return muted;
  };

  return { start, thunder, whoosh, thud, rewind, hiss, setFire, update, toggleMute };
};
