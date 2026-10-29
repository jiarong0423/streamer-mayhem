// true = connecting to Twitch is allowed in this build; set it to false to refuse every live connection (the page then reports LIVE_LOCKED).
export const LIVE_NETWORK_ENABLED=true;
export const TWITCH_ENDPOINTS=Object.freeze({authorize:'https://id.twitch.tv/oauth2/authorize',validate:'https://id.twitch.tv/oauth2/validate',socket:'wss://eventsub.wss.twitch.tv/ws',subscriptions:'https://api.twitch.tv/helix/eventsub/subscriptions'});
