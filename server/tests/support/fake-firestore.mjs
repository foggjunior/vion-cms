// Minimal in-memory Firestore double for isolated server tests. It implements only the calls the CMS
// server modules make: documents, equality/range filters, ordering (including FieldPath.documentId()),
// startAfter, limit, getAll and transactions. No network, credentials or emulator involved.
//
// Transactions follow Firestore's optimistic model closely enough for concurrency tests: every document
// read inside a transaction is recorded with its version; at commit, if any of them changed, the
// transaction function runs again (up to 5 attempts), otherwise all writes apply atomically. Errors thrown
// by the transaction function abort it without a retry, as in Firestore.
const DOC_ID='__name__';
// Deep copy of plain data; Timestamp and Date instances are kept (they are immutable here) so their
// methods survive, as they do in real Firestore snapshots.
const clone=value=>{if(Array.isArray(value))return value.map(clone);if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));return value;};
const comparable=value=>value?.toMillis?value.toMillis():value instanceof Date?value.getTime():value;
const fieldName=field=>typeof field==='string'?field:String(field);
const read=(data,id,field)=>field===DOC_ID?id:field.split('.').reduce((v,k)=>v?.[k],data);
function compare(a,b){a=comparable(a);b=comparable(b);if(a===b)return 0;if(a===undefined||a===null)return -1;if(b===undefined||b===null)return 1;return a<b?-1:1;}
const OPS={'==':(a,b)=>compare(a,b)===0,'!=':(a,b)=>compare(a,b)!==0,'<':(a,b)=>a!==undefined&&compare(a,b)<0,'<=':(a,b)=>a!==undefined&&compare(a,b)<=0,'>':(a,b)=>a!==undefined&&compare(a,b)>0,'>=':(a,b)=>a!==undefined&&compare(a,b)>=0,'in':(a,b)=>b.some(x=>compare(a,x)===0)};

export function fakeFirestore(){
 const store=new Map(),versions=new Map(),stats={reads:0,writes:0,queries:0,transactions:0,retries:0};
 const put=(path,value)=>{store.set(path,value);versions.set(path,(versions.get(path)||0)+1);stats.writes++;};
 const remove=path=>{store.delete(path);versions.set(path,(versions.get(path)||0)+1);stats.writes++;};
 const snap=(path,data)=>{const id=path.split('/').at(-1);return {id,ref:docRef(path),exists:data!==undefined,data:()=>clone(data),get:f=>read(data,id,f),createTime:undefined};};
 function docRef(path){
  return {id:path.split('/').at(-1),path,
   async get(){stats.reads++;return snap(path,store.get(path));},
   async set(value,options){put(path,options?.merge?{...(store.get(path)||{}),...clone(value)}:clone(value));},
   async create(value){if(store.has(path))throw Object.assign(Error('Document already exists'),{code:6});put(path,clone(value));},
   async update(value){if(!store.has(path))throw Object.assign(Error('No document to update'),{code:5});put(path,{...store.get(path),...clone(value)});},
   async delete(){remove(path);},
   collection:name=>collectionRef(path+'/'+name)};
 }
 function query(collection,state={filters:[],order:[],after:null,limit:null}){
  const next=change=>query(collection,{...state,...change});
  return {
   where:(field,op,value)=>next({filters:[...state.filters,{field:fieldName(field),op,value}]}),
   orderBy:(field,dir='asc')=>next({order:[...state.order,{field:fieldName(field),dir}]}),
   startAfter:(...values)=>next({after:values}),
   limit:n=>next({limit:n}),
   async get(){
    stats.queries++;
    const prefix=collection+'/';
    let rows=[...store].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes('/')).map(([path,data])=>({path,id:path.slice(prefix.length),data}));
    rows=rows.filter(row=>state.filters.every(f=>{if(!OPS[f.op])throw Error('Unsupported operator '+f.op);return OPS[f.op](read(row.data,row.id,f.field),f.value);}));
    const order=state.order.some(o=>o.field===DOC_ID)?state.order:[...state.order,{field:DOC_ID,dir:'asc'}];
    const cmp=(a,b)=>{for(const o of order){const c=compare(read(a.data,a.id,o.field),read(b.data,b.id,o.field));if(c)return o.dir==='desc'?-c:c;}return 0;};
    rows.sort(cmp);
    if(state.after)rows=rows.filter(row=>{for(let i=0;i<state.after.length;i++){const o=order[i],c=compare(read(row.data,row.id,o.field),state.after[i]);const d=o.dir==='desc'?-c:c;if(d!==0)return d>0;}return false;});
    if(state.limit!==null)rows=rows.slice(0,state.limit);
    stats.reads+=Math.max(rows.length,1);
    const docs=rows.map(row=>snap(row.path,row.data));
    return {docs,size:docs.length,empty:!docs.length};
   }
  };
 }
 function collectionRef(path){return {...query(path),id:path.split('/').at(-1),path,doc:id=>docRef(path+'/'+(id??crypto.randomUUID()))};}
 const db={
  collection:collectionRef,doc:docRef,stats,store,
  async getAll(...refs){stats.reads+=refs.length;return refs.map(ref=>snap(ref.path,store.get(ref.path)));},
  async runTransaction(fn,{maxAttempts=5}={}){
   for(let attempt=1;;attempt++){
    stats.transactions++;
    const seen=new Map(),writes=[];
    const record=path=>{if(!seen.has(path))seen.set(path,versions.get(path)||0);};
    const tx={
     async get(target){const result=await target.get();if(target.where===undefined)record(target.path);else for(const doc of result.docs)record(doc.ref.path);return result;},
     async getAll(...refs){return Promise.all(refs.map(ref=>tx.get(ref)));},
     set(ref,value,options){writes.push(()=>put(ref.path,options?.merge?{...(store.get(ref.path)||{}),...clone(value)}:clone(value)));return tx;},
     create(ref,value){writes.push(()=>{if(store.has(ref.path))throw Object.assign(Error('Document already exists'),{code:6});put(ref.path,clone(value));});return tx;},
     update(ref,value){writes.push(()=>{if(!store.has(ref.path))throw Object.assign(Error('No document to update'),{code:5});put(ref.path,{...store.get(ref.path),...clone(value)});});return tx;},
     delete(ref){writes.push(()=>remove(ref.path));return tx;}
    };
    const result=await fn(tx);
    // Commit point (synchronous from here, so no other task can interleave).
    if([...seen].some(([path,version])=>(versions.get(path)||0)!==version)){
     stats.retries++;
     if(attempt>=maxAttempts)throw Object.assign(Error('Transaction aborted after repeated contention.'),{code:10});
     continue;
    }
    const before=new Map(store),beforeVersions=new Map(versions);
    try{for(const write of writes)write();}catch(error){store.clear();for(const [k,v] of before)store.set(k,v);versions.clear();for(const [k,v] of beforeVersions)versions.set(k,v);throw error;}
    return result;
   }
  },
  dump:()=>Object.fromEntries([...store].map(([k,v])=>[k,clone(v)]))
 };
 return db;
}
