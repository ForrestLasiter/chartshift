// Small shared controls: icon buttons, a segmented choice, tabs and a menu.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

/** A square button showing only an icon; `label` is its accessible name and tooltip. */
export function IconButton({ icon, label, hint, className = '', ...rest }) {
  return (
    <button type="button" className={`btn icon-only ${className}`} aria-label={label} title={hint || label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** One-of-several choice. Options: [{ id, label, icon?, help? }]. */
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="seg-group">
      <span className="seg-caption" aria-hidden="true">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.help}
            aria-label={o.icon ? o.label : undefined} onClick={() => onChange(o.id)}>
            {o.icon && <Icon name={o.icon} />}
            <span className={o.icon ? 'seg-text' : undefined}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tab strip with arrow-key movement. tabs: [{ id, label, icon? }]; panels use id `${prefix}-panel-${id}`. */
export function Tabs({ label, tabs, value, onChange, prefix }) {
  const refs = useRef({});
  const onKeyDown = (e) => {
    const order = tabs.map((t) => t.id);
    let i = order.indexOf(value);
    if (e.key === 'ArrowRight') i = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft') i = (i + order.length - 1) % order.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = order.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange(order[i]);
    refs.current[order[i]]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`${prefix}-tab-${t.id}`} aria-controls={`${prefix}-panel-${t.id}`}
          aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} ref={(el) => { refs.current[t.id] = el; }}
          onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ prefix, id, children, className = '' }) {
  return <div role="tabpanel" id={`${prefix}-panel-${id}`} aria-labelledby={`${prefix}-tab-${id}`} className={className}>{children}</div>;
}

/**
 * A button that opens a list of actions. items: [{ label, icon?, shortcut?,
 * disabled?, danger?, onSelect }]. Arrow keys move, Escape closes.
 */
export function Menu({ label, icon = 'more', text, items, className = '' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    root.current.querySelector('[role=menuitem]:not(:disabled)')?.focus();
    const outside = (e) => { if (!root.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const onKeyDown = (e) => {
    if (!open) return;
    const list = [...root.current.querySelectorAll('[role=menuitem]:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); list[(i + list.length - 1) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div className={`menu ${className}`} ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className={`btn ${text ? '' : 'icon-only'}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={text ? undefined : label} title={text ? undefined : label} onClick={() => setOpen(!open)}>
        <Icon name={icon} />
        {text && <span>{text}</span>}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
              className={item.danger ? 'danger' : undefined}
              onClick={() => { close(); item.onSelect(); }}>
              {item.icon ? <Icon name={item.icon} /> : <span className="icon" />}
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
