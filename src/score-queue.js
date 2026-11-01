(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const copy = value => JSON.parse(JSON.stringify(value));
  function createScoreQueue({gameSlug, storage = null, send, onChange = () => {}, uuid = () => root.crypto.randomUUID()}) {
    const prefix = gameSlug + ':score-pending:v1:';
    const memory = new Map(), conflicts = new Set();
    let operation = null;
    const same = (a,b) => ['p_submission_id','p_display_name','p_game_slug','p_score','p_client_version'].every(k=>a?.[k]===b?.[k]);
    function valid(item) {
      const p = item?.payload;
      return UUID.test(item?.id || '') && p?.p_submission_id === item.id && p.p_game_slug === gameSlug &&
        typeof p.p_display_name === 'string' && p.p_display_name.trim() !== '' &&
        typeof p.p_client_version === 'string' && Number.isSafeInteger(p.p_score) && p.p_score >= 0 &&
        ['pending','sending','rejected','submitted'].includes(item.state);
    }
    function reconcile(id, raw) {
      if(raw===null)return;
      let item;try{item=JSON.parse(raw);}catch{conflicts.add(id);return;}
      if(!valid(item)||item.id!==id){conflicts.add(id);return;}
      const old=memory.get(id);
      if(old&&!same(old.payload,item.payload)){conflicts.add(id);return;}
      if(!old || item.state==='submitted' || (item.state==='rejected'&&old.state!=='submitted'))memory.set(id,item);
    }
    function save(item) {
      memory.set(item.id, copy(item));
      try {
        if(!storage)return false;
        reconcile(item.id,storage.getItem(prefix+item.id));
        if(conflicts.has(item.id))return false;
        const known=memory.get(item.id);
        if(known.state==='submitted'&&item.state!=='submitted')return false;
        const raw=JSON.stringify(item);
        storage.setItem(prefix+item.id,raw);
        return storage.getItem(prefix+item.id)===raw;
      } catch { return false; }
    }
    function list() {
      try {
        if (storage) for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(prefix)) continue;
          reconcile(key.slice(prefix.length),storage.getItem(key));
        }
      } catch { /* Retain all session records when storage cannot be read. */ }
      return [...memory.values()].filter(item=>item.state!=='submitted').map(item=>({...copy(item),state:conflicts.has(item.id)?'conflict':item.state})).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }
    function notify(item, receipt = null) { try { onChange(copy(item), receipt && copy(receipt)); } catch {} }
    function capture(name, clientVersion) {
      if (!name?.trim()) return null;
      try { const id = uuid(); if (!UUID.test(id)) return null; return Object.freeze({id, name:name.trim(), clientVersion}); }
      catch { return null; }
    }
    function enqueue(play, score, presentation = null) {
      if (!play) return null;
      list();
      if(conflicts.has(play.id))throw new Error('Conflicting saved play; original data preserved');
      const existing = memory.get(play.id);
      const payload = {p_submission_id:play.id,p_display_name:play.name,p_game_slug:gameSlug,p_score:score,p_client_version:play.clientVersion};
      if (existing) {
        if (!same(existing.payload,payload)) throw new Error('A finalized play cannot change');
        return copy(existing);
      }
      const item = {id:play.id,payload,presentation:copy(presentation),createdAt:Date.now(),state:'pending'};
      if (!valid(item)) throw new Error('Invalid finalized score');
      const persisted=save(item);notify({...item,persisted});return {...copy(item),persisted};
    }
    function drain() {
      if (operation) return operation;
      operation = (async () => {
        const attempted = new Set();
        for (;;) {
          const item = list().find(value => !attempted.has(value.id) && !['rejected','conflict'].includes(value.state));
          if (!item) break;
          attempted.add(item.id);item.state='sending';
          if(!save(item)){item.state='pending';if(!conflicts.has(item.id)&&memory.get(item.id)?.state!=='submitted')memory.set(item.id,copy(item));notify({...item,persisted:false});continue;}
          notify({...item,persisted:true});
          try {
            const response = await send(copy(item.payload));
            if(!Array.isArray(response)||response.length!==1)throw new Error('Invalid score acknowledgement');
            const receipt = response[0];
            if (receipt?.accepted === false) { const error=new Error('Score rejected');error.code='PT422';throw error; }
            if (receipt?.accepted !== true) throw new Error('Invalid score acknowledgement');
            if (receipt.result_display_name !== item.payload.p_display_name || receipt.result_normalized_name !== item.payload.p_display_name || !Number.isSafeInteger(receipt.result_first_score) || !Number.isSafeInteger(receipt.result_best_score) || !Number.isSafeInteger(receipt.result_play_count) || receipt.result_play_count < 1 || !['was_duplicate','is_first_play','is_new_best'].every(k=>typeof receipt[k]==='boolean')) throw new Error('Invalid score acknowledgement');
            list();
            if(conflicts.has(item.id)){notify({...item,state:'conflict'});continue;}
            item.state='submitted';
            save(item); // Keep a tombstone. Never recreate a completed receipt on a repeated result callback.
            notify(item, receipt);
          } catch (error) {
            list();
            if(conflicts.has(item.id)||memory.get(item.id)?.state==='submitted')continue;
            item.state = ['PT409','PT422','22023','22001','22003'].includes(error?.code) ? 'rejected' : 'pending';
            const persisted=save(item);notify({...item,persisted});
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
