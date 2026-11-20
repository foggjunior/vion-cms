// Owner-run. Rebuild cms_public from the current workspace, dry run first.
//   npm run public:reconcile                 -> read-only plan (reads Firestore, writes nothing)
//   npm run public:reconcile -- --apply      -> requires CMS_RECONCILE_PROJECT_CONFIRM=<FIREBASE_PROJECT_ID>
// Run the plan, review the counts and paths, then apply. Rerun the plan afterwards: it must report
// create 0, update 0, remove 0.
import {admin} from '../server/firebase.mjs';import {snapshot} from '../server/persistence.mjs';
import {readStoredProjection,planReconciliation,summarise,applyReconciliation} from '../server/public-reconcile.mjs';
import {revalidationJob,processRevalidationJobs} from '../server/revalidation.mjs';
const mode=process.argv[2]||'--plan';
if(!['--plan','--apply'].includes(mode))throw Error('Usage: npm run public:reconcile -- [--plan|--apply]');
const {db}=admin(),workspace=await snapshot(),stored=await readStoredProjection(db),plan=planReconciliation(workspace,stored);
console.log(JSON.stringify({mode,...summarise(plan)},null,2));
if(mode==='--apply'){
 if(!process.env.FIREBASE_PROJECT_ID||process.env.CMS_RECONCILE_PROJECT_CONFIRM!==process.env.FIREBASE_PROJECT_ID)throw Error('Set CMS_RECONCILE_PROJECT_CONFIRM to the intended Firebase project ID before applying.');
 console.log(JSON.stringify(await applyReconciliation(db,plan)));
 // Expire the website's cached copies of everything that changed (no-op when no website is configured).
 const job=revalidationJob([...plan.create,...plan.update].map(c=>({publicPath:c.path,kind:c.value?.kind||null})).concat(plan.remove.map(r=>({publicPath:r.path,kind:r.kind}))));
 if(job){await db.doc(job.path).set(job.value);console.log(JSON.stringify({revalidation:await processRevalidationJobs(db)}));}
}
process.exit(0);
