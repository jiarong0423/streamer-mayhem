// Compatibility wrapper for the synthetic-only OAuth provider.
import {TwitchOAuth,LOCAL_CONFIG} from './twitch_provider.mjs';
export class MockOAuth extends TwitchOAuth {
  constructor(options={}) {super({...options,config:LOCAL_CONFIG,mode:'local'});}
}
