import {afterEach,expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {hermesBootstrapEnvironment} from '../lib/ai/hermes-staff-runtime';

afterEach(()=>vi.unstubAllEnvs());
it('resolves installed dependencies in the cache owner even when the caller has a different private home',()=>{
 const owner=join(tmpdir(),'yru-native-owner'),privateHome=join(owner,'staff-runs','run-private');
 vi.stubEnv('HERMES_HOME',privateHome);
 const environment=hermesBootstrapEnvironment(owner);
 expect(environment.HERMES_HOME).toBe(resolve(owner));
 expect(environment.HERMES_HOME).not.toBe(privateHome);
 expect(environment.PYTHONPATH).toBe(join(resolve(owner),'hermes-agent'));
});
it('disables lazy dependency downloads and does not inherit provider, database or LINE credentials for activation',()=>{
 for(const name of ['OPENAI_API_KEY','GEMINI_API_KEY','DATABASE_URL','LINE_STUDENT_CHANNEL_ACCESS_TOKEN','LINE_STAFF_CHANNEL_SECRET'])vi.stubEnv(name,'synthetic-not-inherited');
 vi.stubEnv('HERMES_DISABLE_LAZY_INSTALLS','0');
 const environment=hermesBootstrapEnvironment(join(tmpdir(),'yru-native-owner'));
 expect(environment.HERMES_DISABLE_LAZY_INSTALLS).toBe('1');
 for(const name of ['OPENAI_API_KEY','GEMINI_API_KEY','DATABASE_URL','LINE_STUDENT_CHANNEL_ACCESS_TOKEN','LINE_STAFF_CHANNEL_SECRET'])expect(environment).not.toHaveProperty(name);
});
