// Shared popup-to-subscription lifecycle for the configured and local providers.
import {AuthPopupController} from './auth_popup_controller.mjs';
import {LIVE_NETWORK_ENABLED} from './twitch_endpoints.mjs';

export class ProviderActivation {
  constructor({provider,origin,openWindow,onState=()=>{}}={}) {
    if(!provider || typeof provider.start!=='function' || typeof provider.stop!=='function' || !provider.oauth)throw new TypeError('provider required');
    this.provider=provider;this.onState=onState;this.active=false;
    this.popup=new AuthPopupController({oauth:provider.oauth,origin,openWindow,
      onState:state=>{if(state!=='SUCCESS')this.onState(state);},
      onSuccess:()=>{
        try {this.active=true;this.onState('AUTHORIZED');if(!this.provider.start())throw new Error('START_FAILED');}
        catch {this.active=false;this.provider.oauth.clear();this.onState('FAILED');}
      }});
  }
  start() {
    if(this.provider.mode==='live' && !LIVE_NETWORK_ENABLED){this.onState('LIVE_LOCKED');return false;}
    if(this.active || this.popup.pending)return false;
    return this.popup.start();
  }
  handleMessage(event){return this.popup.handleMessage(event);}
  stop() {
    const wasActive=this.active;this.active=false;
    this.popup.dispose();
    if(wasActive)this.provider.stop();else this.provider.oauth.clear();
  }
}
