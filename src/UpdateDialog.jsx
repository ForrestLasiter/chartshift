// "Check for updates": asks GitHub for the latest release, and if there is a
// newer one, downloads its installer and starts it.
import { useEffect, useState } from 'react';
import { Modal } from './dialogs.jsx';
import { Icon } from './icons.jsx';
import { settings, update } from './lib/platform.js';

const megabytes = (bytes) => `${Math.round(bytes / 1048576)} MB`;

export function UpdateDialog({ unsaved, onClose, onChecked }) {
  const [phase, setPhase] = useState('checking'); // checking | current | available | downloading | ready | starting | error
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [atStartup, setAtStartup] = useState(false);
  useEffect(() => { settings.get().then((s) => setAtStartup(s.checkUpdatesAtStartup)).catch(() => {}); }, []);
  const toggleStartup = async (on) => {
    setAtStartup(on);
    try { setAtStartup((await settings.set({ checkUpdatesAtStartup: on })).checkUpdatesAtStartup); } catch { setAtStartup(!on); }
  };

  const check = async () => {
    setPhase('checking');
    setError('');
    if (!update) { setError('Updates can only be checked from the installed app.'); setPhase('error'); return; }
    try {
      const latest = await update.check();
      setInfo(latest);
      onChecked?.(latest);
      setPhase(latest.available ? 'available' : 'current');
    } catch (err) {
      setError(err.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setPhase('error');
    }
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (update ? update.onProgress(setProgress) : undefined), []);

  const fail = (err) => { setError(err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); setPhase('error'); };
  const download = async () => {
    setProgress({ received: 0, total: info.size });
    setPhase('downloading');
    try { await update.download(); setPhase('ready'); } catch (err) { fail(err); }
  };
  const install = async () => {
    setPhase('starting');
    try { await update.install(); } catch (err) { fail(err); }
  };

  const percent = progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const footer = (
    <>
      {phase === 'error' && <button type="button" className="btn outline" onClick={check}>Try again</button>}
      {phase === 'available' && <button type="button" className="btn primary" onClick={download}><Icon name="update" />Download version {info.version}</button>}
      {phase === 'ready' && <button type="button" className="btn primary" onClick={install} disabled={!info.canInstall}>Close ChartShift and install</button>}
      <button type="button" className="btn outline" onClick={onClose} disabled={phase === 'starting'}>{phase === 'ready' || phase === 'available' ? 'Not now' : 'Close'}</button>
    </>
  );

  return (
    <Modal title="Check for updates" onClose={onClose} footer={footer}>
      <div className="modal-body">
        {phase === 'checking' && <p role="status"><span className="spinner" aria-hidden="true" /> Asking GitHub for the latest version…</p>}

        {phase === 'current' && (
          <p className="fact update-result" role="status"><Icon name="check" /><span><strong>ChartShift is up to date.</strong> You have version {info.current}, which is the latest.</span></p>
        )}

        {(phase === 'available' || phase === 'downloading' || phase === 'ready' || phase === 'starting') && (
          <>
            <p className="fact update-result" role="status">
              <span><strong>Version {info.version} is available.</strong> You have {info.current}. The download is {megabytes(info.size)}.</span>
            </p>
            {info.notes && (
              <>
                <h3>What is in it</h3>
                <pre className="release-notes" tabIndex={0} aria-label={`Release notes for version ${info.version}`}>{info.notes}</pre>
              </>
            )}
          </>
        )}

        {phase === 'downloading' && (
          <>
            <progress value={percent} max="100" aria-label="Download progress" />
            <p role="status">Downloading… {percent}% ({megabytes(progress.received)} of {megabytes(progress.total || info.size)})</p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <p role="status"><strong>The update is downloaded and checked.</strong> Installing closes ChartShift and opens the installer; your songs in the library are kept.</p>
            {unsaved && <p className="note"><Icon name="alert" /><span><strong>This song has unsaved changes.</strong> Choose “Not now”, save it, then check for updates again; otherwise those changes are lost when ChartShift closes.</span></p>}
            {!info.canInstall && <p className="note"><Icon name="alert" /><span>This copy is running from source, so it cannot install over itself. Use <code>git pull</code> instead.</span></p>}
            <p className="muted">Windows will show an “unknown publisher” warning, because the installer is not code-signed: choose More info, then Run anyway.</p>
          </>
        )}

        {phase === 'starting' && <p role="status"><span className="spinner" aria-hidden="true" /> Starting the installer and closing ChartShift…</p>}

        {phase === 'error' && <p className="error update-result" role="alert">{error}</p>}

        <label className="check">
          <input type="checkbox" checked={atStartup} onChange={(e) => toggleStartup(e.target.checked)} />
          <span>Check for updates when ChartShift starts<br /><span className="muted">It asks github.com once each time the app opens and tells you if there is a newer version. It never downloads or installs anything by itself.</span></span>
        </label>
        <p className="muted">Checking contacts github.com, where ChartShift’s releases are published. Nothing about you or your songs is sent.</p>
      </div>
    </Modal>
  );
}
