(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const copy = value => JSON.parse(JSON.stringify(value));
  function createScoreQueue({gameSlug, storage = null, send, onChange = () => {}, uuid = () => root.crypto.randomUUID()}) {
    const prefix = gameSlug + ':score-pending:v1:';
    const memory = new Map();
    let operation = null;
    function valid(item) {
      const p = item?.payload;
      return ['pending','sending','rejected'].includes(item?.state) && UUID.test(item?.id || '') && p?.p_submission_id === item.id && p.p_game_slug === gameSlug &&
        typeof p.p_display_name === 'string' && p.p_display_name.trim() !== '' &&
        typeof p.p_client_version === 'string' && Number.isInteger(p.p_score) && p.p_score >= 0;
    }
    function save(item) {
      memory.set(item.id, copy(item));
      try { storage?.setItem(prefix + item.id, JSON.stringify(item)); } catch { /* Keep this session usable. */ }
      return item;
    }
    function list() {
      try {
        if (storage) for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(prefix)) continue;
          try { const item = JSON.parse(storage.getItem(key)); if (valid(item)) memory.set(item.id, item); } catch { /* Preserve malformed data without sending it. */ }
        }
      } catch { /* Memory contains records saved in this session. */ }
      return [...memory.values()].map(copy).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }
    function notify(item, receipt = null) { try { onChange(copy(item), receipt && copy(receipt)); } catch {} }
    function capture(name, clientVersion) {
      if (!name?.trim()) return null;
      try { const id = uuid(); if (!UUID.test(id)) return null; return Object.freeze({id, name:name.trim(), clientVersion}); }
      catch { return null; }
    }
    function enqueue(play, score, presentation = null) {
      if (!play) return null;
      const existing = list().find(item => item.id === play.id);
      const payload = {p_submission_id:play.id,p_display_name:play.name,p_game_slug:gameSlug,p_score:score,p_client_version:play.clientVersion};
      if (existing) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) throw new Error('A finalized play cannot change');
        return existing;
      }
      const item = {id:play.id,payload,presentation:copy(presentation),createdAt:Date.now(),state:'pending'};
      if (!valid(item)) throw new Error('Invalid finalized score');
      save(item);notify(item);return copy(item);
    }
    function drain() {
      if (operation) return operation;
      operation = (async () => {
        const attempted = new Set();
        for (;;) {
          const item = list().find(value => !attempted.has(value.id) && value.state !== 'rejected');
          if (!item) break;
          attempted.add(item.id);item.state='sending';save(item);notify(item);
          try {
            const response = await send(copy(item.payload));
            const receipt = Array.isArray(response) ? response[0] : response;
            if (receipt?.accepted === false) { const error=new Error('Score rejected');error.code='PT422';throw error; }
            if (receipt?.accepted !== true) throw new Error('Invalid score acknowledgement');
            if (receipt.result_display_name !== item.payload.p_display_name || receipt.result_normalized_name !== item.payload.p_display_name || !Number.isInteger(receipt.result_first_score) || !Number.isInteger(receipt.result_best_score) || !Number.isInteger(receipt.result_play_count) || receipt.result_play_count < 1 || typeof receipt.was_duplicate !== 'boolean') throw new Error('Invalid score acknowledgement');
            item.state='submitted';
            memory.delete(item.id);
            try { storage?.removeItem(prefix + item.id); } catch { /* Same ID is safe to retry after reload. */ }
            notify(item, receipt);
          } catch (error) {
            item.state = ['PT409','PT422','22023','22001','22003'].includes(error?.code) ? 'rejected' : 'pending';
            save(item);notify(item);
          }
        }
      })().finally(() => { operation=null; });
      return operation;
    }
    return {capture,enqueue,list,drain,prefix};
  }
  const api={createScoreQueue};
  if (typeof module === 'object' && module.exports) module.exports=api;
  root.CommonScoreQueue=api;
})(typeof globalThis === 'object' ? globalThis : this);
