// Runs inside the desk container; credentials never appear in process arguments/output.
import { runDoctor } from './doctor-client.js'
try {
  await runDoctor({token:process.env.NEWS_LOCAL_ADMIN_TOKEN||'',account:process.argv.includes('--account'),paidRun:process.argv.includes('--paid-run')})
}catch(error){console.error(error instanceof Error?error.message:'News verification failed');process.exitCode=1}
