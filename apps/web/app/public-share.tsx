'use client';

import { useEffect, useId, useState } from 'react';

export default function PublicShare({ path, title }: { path: string; title: string }) {
  const id = useId();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setUrl(new URL(path, globalThis.location.origin).href);
    setNotice('');
    setError('');
  }, [path]);

  const copy = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      if (!globalThis.navigator.clipboard?.writeText) throw new Error('El navegador no permite copiar el enlace.');
      await globalThis.navigator.clipboard.writeText(url);
      setNotice('Enlace público copiado.');
    } catch {
      setError('No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="managerCard" aria-label="Compartir enlace público">
      <h2>Compartir</h2>
      <p>Este enlace permite consultar la información pública; no permite editarla.</p>
      <label className="managerField" htmlFor={id}>
        <span>Enlace público</span>
        <input id={id} type="url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className="managerActions">
        <button className="managerButtonOutline" type="button" disabled={!url || busy} onClick={() => void copy()}>
          Copiar enlace
        </button>
        {url ? (
          <a
            className="managerButtonSolid"
            href={`https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Compartir por WhatsApp
          </a>
        ) : null}
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
