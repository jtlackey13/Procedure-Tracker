/* Pure procedure statistics and classification logic. No patient data is handled here. */
(function (root) {
  'use strict';
  const TYPES = ['clinical', 'supervised', 'review', 'simulation_low', 'simulation_high'];
  const byDateDesc = (a,b) => String(b.performed_on).localeCompare(String(a.performed_on)) || String(b.created_at||'').localeCompare(String(a.created_at||''));
  const latest = (arr) => arr.length ? [...arr].sort(byDateDesc)[0].performed_on : null;
  const rowLabel = p => p.procedure_group + (p.variant ? ' · ' + p.variant : '');
  const findRow = (rows, cat, group, variant) => rows.find(x => x.category === cat && x.procedure_group === group && x.variant === variant);
  function computeAttribution(primary, secondary, catalog, patientGroup) {
    if (!primary) return [];
    const valid = new Map(catalog.map(p => [p.id,p]));
    const ids = new Set();
    for (const item of [primary, ...(secondary || [])]) {
      if (!item || !valid.has(item.id)) continue;
      ids.add(item.id);
      for (const id of (item.rollup_ids || [])) if(valid.has(id)) ids.add(id);
      if (item.category === 'Vascular Access' && [
        'Arterial Lines','Central Venous Access (Location)','Central Venous Access (Type)'
      ].includes(item.procedure_group)) {
        const group = item.procedure_group === 'Arterial Lines' ? 'Arterial Lines' : 'Central Venous Access (Location)';
        if (patientGroup === 'adult' || patientGroup === 'pediatric') {
          const parent = findRow(catalog,'Vascular Access',group, patientGroup === 'adult' ? 'Total Adults' : 'Total Pediatrics');
          if (parent) ids.add(parent.id);
        }
      }
    }
    return [...ids];
  }
  function computeMetrics(catalog, entries) {
    const result = new Map(catalog.map(p => [p.id, {
      row:p, clinical:[], supervised:[], review:[], simulation:[],
      historicalTotal:Number(p.historical_total) || 0,
      historicalSuccess:p.outcome_applicable ? Number(p.historical_success) || 0 : null
    }]));
    const lookup = new Map(catalog.map(p => [p.id,p]));
    for (const e of entries) {
      const target = e.kind==='clinical'?'clinical':e.kind==='supervised'?'supervised':e.kind==='review'?'review':'simulation';
      // Re-evaluate attributions when classification settings change.
      const mapped = computeAttribution(lookup.get(e.procedure_id),
        (e.additional_ids || []).map(id => lookup.get(id)).filter(Boolean),catalog,e.patient_group);
      for (const id of new Set(mapped.length ? mapped : [e.procedure_id])) {
        const row = result.get(id);
        if (row) row[target].push(e);
      }
    }
    for (const r of result.values()) {
      const sorted = [...r.clinical].sort(byDateDesc);
      const known = sorted.filter(x => typeof x.overall_success === 'boolean');
      const first = sorted.filter(x => typeof x.first_attempt_success === 'boolean');
      const recent = known.slice(0,10);
      const denominator = r.historicalTotal + known.length;
      r.total = r.historicalTotal + sorted.length;
      r.successes = (r.historicalSuccess || 0) + known.filter(x => x.overall_success).length;
      r.overallRate = r.row.outcome_applicable && denominator > 0 ? 100*r.successes/denominator : null;
      r.firstRate = r.row.outcome_applicable && first.length ? 100*first.filter(x => x.first_attempt_success).length/first.length : null;
      r.firstN = first.length;
      r.recentRate = r.row.outcome_applicable && recent.length ? 100*recent.filter(x => x.overall_success).length/recent.length : null;
      r.recentN = recent.length;
      r.knownSuccessN = denominator;
      r.lastClinical = latest(sorted);
      r.lastReview = latest(r.review);
      r.lastSimulation = latest(r.simulation);
      r.supervisedCount = r.supervised.length;
      r.simulationCount = r.simulation.length;
      r.reviewCount = r.review.length;
    }
    return result;
  }
  function daysBetween(a,b) {
    if (!a||!b) return null;
    return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
  }
  function practiceStatus(p, metrics, today) {
    function clock(interval, ownDate) {
      if (!p.halo || !interval) return {state:'off',label:'Not scheduled',dueDate:null};
      // Only the activity on this specific practice track resets its clock.
      // Clinical procedures remain separately visible and never silently reset practice schedules.
      if (!ownDate) return {state:'due',label:'Due · never documented',dueDate:null};
      const elapsed = daysBetween(ownDate,today);
      const remaining = interval - elapsed;
      const dueDate = new Date(Date.parse(ownDate+'T12:00:00Z') + interval*86400000).toISOString().slice(0,10);
      return remaining < 0 ? {state:'due',label:`Overdue ${Math.abs(remaining)}d`,dueDate} :
        remaining === 0 ? {state:'due',label:'Due today',dueDate} :
        remaining <= 14 ? {state:'soon',label:`Due in ${remaining}d`,dueDate} :
        {state:'ok',label:`Due in ${remaining}d`,dueDate};
    }
    return {review:clock(p.review_interval_days, metrics?.lastReview), simulation:clock(p.sim_interval_days, metrics?.lastSimulation)};
  }
  root.ProcedureLogic = {TYPES,byDateDesc,rowLabel,computeAttribution,computeMetrics,practiceStatus,daysBetween};
})(typeof window !== 'undefined' ? window : globalThis);
