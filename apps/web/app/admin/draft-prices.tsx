'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { membershipDurations, organizerPackages, trialPlans } from '@playsport/shared';
import { accessRequest } from '../account/access/access-request';

type Price = { key: string; name: string; currency: string; amountCents: number | null; revision: number; updatedAt: string };
const predefined = [
  ...trialPlans.filter(plan => plan.id !== 'organizer').flatMap(plan => membershipDurations.map(duration => ({
    key: `${plan.id}:${duration.months}`, name: `${plan.name} · ${duration.name}`,
  }))),
  ...organizerPackages.map(plan => ({ key: `organizer:${plan.id}`, name: `Organizador · ${plan.name} · por torneo` })),
  { key: 'organizer:custom-activation', name: 'Organizador · personalizado · activación por torneo' },
  { key: 'organizer:custom-game', name: 'Organizador · personalizado · por partido' },
  { key: 'organizer:extra-game', name: 'Organizador · ampliación · por partido adicional' },
  { key: 'scorekeeper:extra-game', name: 'Anotador · acceso puntual por partido' },
];

export default function DraftPrices({ accountId }: { accountId: string }) {
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [selected, setSelected] = useState(predefined[0].key), [name, setName] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [amount, setAmount] = useState(''), [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    accessRequest('/api/accounts/draft-prices').then(value => {
      if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId || !('prices' in value) || !Array.isArray(value.prices))
        throw new Error('La respuesta de precios no es válida.');
      if (active) {
        const loaded = value.prices as Price[], price = loaded.find(item => item.key === selected);
        setPrices(loaded); setAmount(price?.amountCents == null ? '' : (price.amountCents / 100).toFixed(2));
        setCurrency(price?.currency ?? 'USD'); setError(''); setNotice('');
      }
    }).catch(failure => { if (active) { setPrices(null); setError(failure instanceof Error ? failure.message : 'No se pudieron consultar los precios.'); } });
    return () => { active = false; };
  }, [accountId, attempt]);
  const customPrices = prices?.filter(price => !predefined.some(item => item.key === price.key)) ?? [];
  const choices = [...predefined, ...customPrices];
  const current = prices?.find(price => price.key === selected);
  const choice = choices.find(item => item.key === selected);
  const [selectedPlan, selectedDuration] = selected.split(':');
  const role = selected.startsWith('player:') || selected.startsWith('player-numbers:') ? 'player' :
    selectedPlan.startsWith('manager') ? 'manager' : selectedPlan === 'scorekeeper' || selectedPlan.startsWith('scorekeeper-') ? 'scorekeeper' :
      selectedPlan === 'organizer' ? 'organizer' : 'other';
  const isExtraGame = selected === 'scorekeeper:extra-game';
  const planIds = role === 'player' ? ['player-numbers', 'player'] : role === 'manager' ?
    ['manager-basic', 'manager-numbers', 'manager'] : role === 'scorekeeper' ?
      ['scorekeeper-basic', 'scorekeeper-numbers', 'scorekeeper'] : [];
  const plans = planIds.map(id => trialPlans.find(plan => plan.id === id)!).filter(Boolean);
  const choose = (key: string) => {
    const price = prices?.find(item => item.key === key);
    if (key === 'new') setCustomKey(`custom:${globalThis.crypto.randomUUID()}`);
    setSelected(key); setName(''); setAmount(price?.amountCents == null ? '' : (price.amountCents / 100).toFixed(2));
    setCurrency(price?.currency ?? 'USD'); setError(''); setNotice('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const raw = amount.trim().replace(',', '.');
    if (raw && !/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) { setError('Ingresa un importe válido con hasta dos decimales.'); return; }
    const parts = raw.split('.');
    const amountCents = raw ? Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0')) : null;
    const key = selected === 'new' ? customKey : selected;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await accessRequest('/api/accounts/draft-prices', { expectedAdminId: accountId, key,
        name: selected === 'new' ? name.trim() : choice?.name, currency, amountCents, expectedRevision: current?.revision ?? 0 });
      if (!response || typeof response !== 'object' || !('price' in response) || !response.price || typeof response.price !== 'object')
        throw new Error('No se confirmó el precio. Actualiza el catálogo antes de reintentar.');
      const price = response.price as Price;
      if (price.key !== key || price.revision !== (current?.revision ?? 0) + 1) throw new Error('La confirmación no corresponde al cambio. Actualiza el catálogo.');
      setPrices(previous => [...(previous ?? []).filter(item => item.key !== key), price]);
      setSelected(key); setName(''); setNotice('Borrador guardado. No se publicó ni se realizó ningún cobro.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el precio.'); }
    finally { setBusy(false); }
  };
  return <section className="managerCard managerStepCard"><h2>Precios en borrador</h2>
    <p>Privados y sin cobros. Un campo vacío significa sin configurar; cero es un precio explícito.</p>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
    {prices === null ? <button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Actualizar precios</button> :
      <form onSubmit={event => void save(event)}><fieldset className="adminTrialFields" disabled={busy}>
        <div className="adminPriceSelectors">
          <label className="managerField"><span>Rol</span><select value={role} onChange={event => {
            const keys: Record<string, string> = { player: 'player-numbers:1', manager: 'manager-basic:1',
              scorekeeper: 'scorekeeper-basic:1', organizer: 'organizer:small', other: customPrices[0]?.key ?? 'new' };
            choose(keys[event.target.value]);
          }}>
            <option value="player">Jugador</option><option value="manager">Manager</option>
            <option value="scorekeeper">Anotador</option><option value="organizer">Organizador</option>
            <option value="other">Otros conceptos</option>
          </select></label>
          {plans.length ? <>
            <label className="managerField"><span>Nivel</span><select value={isExtraGame ? 'extra-game' : selectedPlan} onChange={event => {
              choose(event.target.value === 'extra-game' ? 'scorekeeper:extra-game' :
                `${event.target.value}:${isExtraGame ? '1' : selectedDuration}`);
            }}>
              {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name.split(' · ').slice(1).join(' · ')}</option>)}
              {role === 'scorekeeper' ? <option value="extra-game">Acceso puntual por partido</option> : null}
            </select></label>
            {!isExtraGame ? <label className="managerField"><span>Duración</span><select value={selectedDuration} onChange={event => choose(`${selectedPlan}:${event.target.value}`)}>
              {membershipDurations.map(duration => <option key={duration.months} value={duration.months}>{duration.name}</option>)}
            </select></label> : null}
          </> : role === 'organizer' ? <label className="managerField"><span>Paquete o concepto</span><select value={selected} onChange={event => choose(event.target.value)}>
            {predefined.filter(item => item.key.startsWith('organizer:')).map(item => <option key={item.key} value={item.key}>{item.name.replace('Organizador · ', '')}</option>)}
          </select></label> : <label className="managerField"><span>Concepto</span><select value={selected} onChange={event => choose(event.target.value)}>
            {customPrices.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
            <option value="new">Agregar otro concepto</option>
          </select></label>}
        </div>
        {selected === 'new' ? <label className="managerField"><span>Nombre del concepto</span><input value={name} onChange={event => setName(event.target.value)} required maxLength={150} /></label> : null}
        <label className="managerField"><span>Moneda</span><select value={currency} onChange={event => setCurrency(event.target.value)}>
          <option value="USD">USD · dólar estadounidense</option><option value="VES">VES · bolívar</option><option value="EUR">EUR · euro</option>
        </select></label>
        <label className="managerField"><span>Importe</span><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="Sin configurar" /></label>
        <p>{current ? `Revisión ${current.revision} · Actualizado ${new Date(current.updatedAt).toLocaleString('es-VE')}` : 'Sin configurar'}</p>
        <div className="managerButtonRow"><button className="managerButtonSolid">Guardar borrador</button>
          <button type="button" className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Actualizar precios</button></div>
      </fieldset></form>}
  </section>;
}