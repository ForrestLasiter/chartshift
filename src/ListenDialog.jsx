// "Chords from a recording": record an instrument (or choose an audio file),
// work out the chords being played, and put them into a song.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './dialogs.jsx';
import { Icon } from './icons.jsx';
import { chordsToText, clock, detectChords } from './lib/audioChords.js';
import { keyName } from './lib/chords.js';
import { createRecorder, decodeAudio } from './lib/audioInput.js';

const nextPaint = () => new Promise((resolve) => setTimeout(resolve, 30));

export function ListenDialog({ pickFile, canAppend, onUse, onClose }) {
  const [phase, setPhase] = useState('start'); // start | recording | working | result
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [perLine, setPerLine] = useState(4);
  const [text, setText] = useState('');
  const [now, setNow] = useState(0);
  const recorder = useMemo(createRecorder, []);
  const player = useRef(null);
  const audioUrl = useRef(null);

  useEffect(() => () => {
    recorder.cancel();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
  }, [recorder]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const analyse = async (bytes, type) => {
    setPhase('working');
    setError('');
    try {
      await nextPaint();
      const audio = await decodeAudio(bytes);
      await nextPaint();
      const found = detectChords(audio.samples, audio.sampleRate);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(new Blob([bytes], type ? { type } : undefined));
      setResult(found);
      setText(chordsToText(found.chords, { perLine }));
      setNow(0);
      setPhase('result');
    } catch (err) {
      setError(err.message);
      setPhase('start');
    }
  };

  const record = async () => {
    setError('');
    try {
      await recorder.start();
      setSeconds(0);
      setPhase('recording');
    } catch (err) { setError(err.message); }
  };
  const stop = async () => {
    const recording = await recorder.stop();
    if (recording) analyse(recording.bytes, recording.type);
  };
  const choose = async () => {
    setError('');
    try {
      const file = await pickFile();
      if (file) analyse(file.data, '');
    } catch (err) { setError(err.message); }
  };
  const changePerLine = (value) => {
    setPerLine(value);
    setText(chordsToText(result.chords, { perLine: value }));
  };
  const jump = (chord) => {
    const audio = player.current;
    if (!audio) return;
    audio.currentTime = chord.start;
    audio.play().catch(() => {});
  };

  const chords = result?.chords || [];
  const current = chords.findIndex((c) => now >= c.start && now < c.end);

  const footer = phase === 'result' ? (
    <>
      <button type="button" className="btn outline" onClick={() => { setResult(null); setPhase('start'); }}>Try another recording</button>
      <span className="grow" />
      {canAppend && <button type="button" className="btn outline" disabled={!text.trim()} onClick={() => onUse(text, result, 'append')}>Add to the end of this song</button>}
      <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onUse(text, result, 'new')}>Start a new song with these chords</button>
    </>
  ) : <button type="button" className="btn outline" onClick={onClose}>Close</button>;

  return (
    <Modal title="Chords from a recording" onClose={onClose} wide footer={footer}>
      <div className="modal-body">
        <p className="experimental"><span className="badge">Experimental</span> This feature is new and has only been tried on computer-generated playing. Expect mistakes, and please check the result by ear.</p>
        {phase === 'start' && (
          <>
            <p>Play the song on one instrument and ChartShift will work out the chords and write them down for you to tidy up.</p>
            <div className="row wrap">
              <button type="button" className="btn primary large" onClick={record}><Icon name="mic" />Record with the microphone</button>
              <button type="button" className="btn outline large" onClick={choose}><Icon name="folder" />Choose an audio file…</button>
            </div>
            <div className="note">
              <Icon name="alert" />
              <div>
                <p><strong>For the best result:</strong> one guitar or piano, playing chords clearly, with no singing and little background noise.</p>
                <p>It hears plain major and minor chords. A seventh or sus chord is written as the chord it is built on, and it will make mistakes, so treat the result as a first draft.</p>
              </div>
            </div>
          </>
        )}

        {phase === 'recording' && (
          <>
            <p className="recording" role="status"><span className="rec-dot" aria-hidden="true" />Recording… {clock(seconds)}</p>
            <p className="muted">Play the song through, then stop. Nothing is saved or sent anywhere; the recording stays in this window.</p>
            <div className="row">
              <button type="button" className="btn primary large" onClick={stop}>Stop and find the chords</button>
              <button type="button" className="btn outline large" onClick={() => { recorder.cancel(); setPhase('start'); }}>Cancel</button>
            </div>
          </>
        )}

        {phase === 'working' && <p role="status"><span className="spinner" aria-hidden="true" /> Listening for the chords…</p>}

        {phase === 'result' && (
          <>
            <p className="fact" role="status">
              <strong>{chords.length ? `${chords.length} chord change${chords.length === 1 ? '' : 's'}` : 'No chords were heard'}</strong>
              <span className="muted">
                {' '}in {clock(result.duration)}{result.key ? ` · key looks like ${keyName(result.key)}` : ''}
                {Math.abs(result.tuning) >= 15 ? ` · tuned about ${Math.abs(result.tuning)} cents ${result.tuning > 0 ? 'sharp' : 'flat'}` : ''}
              </span>
            </p>
            <audio ref={player} controls src={audioUrl.current} onTimeUpdate={(e) => setNow(e.target.currentTime)} aria-label="The recording" />
            {chords.length > 0 ? (
              <>
                <ol className="chord-timeline" aria-label="Chords heard, in order. Choose one to hear that part.">
                  {chords.map((chord, i) => (
                    <li key={`${chord.start}-${i}`}>
                      <button type="button" className={`btn outline chord-chip${i === current ? ' playing' : ''}`} aria-current={i === current ? 'true' : undefined}
                        aria-label={`${chord.name} at ${clock(chord.start)}`} onClick={() => jump(chord)}>
                        <strong>{chord.name}</strong><span>{clock(chord.start)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="row bottom">
                  <label className="field grow">The chords as song text (you can correct them here)
                    <textarea className="listen-text" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
                  </label>
                  <label className="field">Chords on a line
                    <select value={perLine} onChange={(e) => changePerLine(Number(e.target.value))}>
                      {[2, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
              </>
            ) : <p className="muted">The recording may be too quiet, or not clear enough to pick chords out of. Try again closer to the instrument.</p>}
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
