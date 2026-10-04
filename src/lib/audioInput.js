// Getting sound into the app: decoding an audio file, and recording from the
// microphone. Browser APIs only; the analysis itself is in audioChords.js.

const MAX_SECONDS = 15 * 60;
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** Decodes an audio file (wav, mp3, m4a, ogg, flac, webm…) to mono samples. */
export async function decodeAudio(bytes) {
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new Error('That recording is too large (over 200 MB).');
  const context = new AudioContext();
  try {
    let buffer;
    try {
      buffer = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch {
      throw new Error('That file could not be read as audio. Try a WAV, MP3 or M4A file.');
    }
    if (buffer.duration > MAX_SECONDS) throw new Error('That recording is longer than 15 minutes. Use a shorter one.');
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate, duration: buffer.duration };
  } finally {
    context.close();
  }
}

/**
 * Records from the microphone. start() resolves once recording is under way;
 * stop() resolves with the recording as bytes. The sound is taken as it is:
 * the echo, noise and volume processing meant for speech is switched off,
 * because it mangles music.
 */
export function createRecorder() {
  let stream = null, recorder = null, chunks = [];
  return {
    async start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This PC has no way to record sound.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (error) {
        throw new Error(error.name === 'NotFoundError' ? 'No microphone was found.'
          : 'The microphone could not be used. Check that one is plugged in and that Windows allows apps to use it (Settings → Privacy → Microphone).');
      }
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start(1000);
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder) return resolve(null);
        recorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType });
          recorder = null;
          resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type });
        };
        recorder.stop();
      });
    },
    cancel() {
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
      stream?.getTracks().forEach((track) => track.stop());
      recorder = null;
    },
  };
}
