import 'dotenv/config';
import {assertDevelopmentTarget} from '../../lib/database/development-target';
import {provisionChatMediaStorage} from '../../lib/chat/media-storage';

try{
 assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
  supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
 await provisionChatMediaStorage();
 console.log('CHAT_MEDIA_PRIVATE_STORAGE_READY');
}catch{console.error('CHAT_MEDIA_STORAGE_SETUP_FAILED');process.exitCode=1;}
