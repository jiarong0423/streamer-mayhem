// Local synthetic OAuth and EventSub simulator; no Twitch service calls or persisted tokens.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"
)

const origin = "http://127.0.0.1:4173"
const redirect = origin + "/oauth-callback.html"
const client = "streamer-mayhem-mock"

type token struct {
	user   string
	scopes []string
	expiry time.Time
}
type subscription struct {
	ID        string            `json:"id"`
	Status    string            `json:"status"`
	Type      string            `json:"type"`
	Version   string            `json:"version"`
	Condition map[string]string `json:"condition"`
	Transport map[string]string `json:"transport"`
}
type session struct {
	id    string
	conn  *websocket.Conn
	write sync.Mutex
	sub   *subscription
}
type simulator struct {
	mu         sync.Mutex
	tokens     map[string]token
	sessions   map[string]*session
	migrations map[string]string
}

func random(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("secure randomness unavailable")
	}
	return hex.EncodeToString(b)
}
func (s *session) send(v any) error {
	s.write.Lock()
	defer s.write.Unlock()
	return s.conn.WriteJSON(v)
}
func envelope(kind string, payload any) map[string]any {
	return map[string]any{"metadata": map[string]string{"message_id": random(16), "message_type": kind, "message_timestamp": time.Now().UTC().Format(time.RFC3339Nano)}, "payload": payload}
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func cors(w http.ResponseWriter, r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o != "" && o != origin {
		return false
	}
	if o != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Client-Id, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.WriteHeader(204)
		return false
	}
	return true
}
func (m *simulator) validate(raw, scheme string) (token, bool) {
	if !strings.HasPrefix(raw, scheme+" ") {
		return token{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.tokens[strings.TrimPrefix(raw, scheme+" ")]
	return v, ok && time.Now().Before(v.expiry)
}
func (m *simulator) authorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method", 405)
		return
	}
	q := r.URL.Query()
	state := q.Get("state")
	if q.Get("client_id") != client || q.Get("redirect_uri") != redirect || q.Get("response_type") != "token" || q.Get("scope") != "user:read:chat" || len(state) != 64 || strings.Trim(state, "0123456789abcdef") != "" {
		http.Error(w, "invalid request", 400)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'")
	if q.Get("decision") == "" {
		a := q
		a.Set("decision", "allow")
		allow := "/oauth2/authorize?" + a.Encode()
		a.Set("decision", "deny")
		deny := "/oauth2/authorize?" + a.Encode()
		tmpl := template.Must(template.New("consent").Parse(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>本機模擬授權</title><body><h1>本機模擬授權</h1><p>僅測試假帳號與聊天室讀取權限，不會連到 Twitch。</p><a href="{{.Allow}}">允許模擬授權</a>　<a href="{{.Deny}}">拒絕</a></body></html>`))
		_ = tmpl.Execute(w, map[string]string{"Allow": allow, "Deny": deny})
		return
	}
	result := url.Values{"state": {state}}
	if q.Get("decision") == "deny" {
		result.Set("error", "access_denied")
	} else if q.Get("decision") == "allow" {
		t := "mock_" + random(24)
		m.mu.Lock()
		for k, v := range m.tokens {
			if time.Now().After(v.expiry) {
				delete(m.tokens, k)
			}
		}
		if len(m.tokens) >= 64 {
			m.mu.Unlock()
			http.Error(w, "mock capacity", 503)
			return
		}
		m.tokens[t] = token{user: "synthetic-user", scopes: []string{"user:read:chat"}, expiry: time.Now().Add(time.Hour)}
		m.mu.Unlock()
		result.Set("access_token", t)
		result.Set("token_type", "bearer")
		result.Set("scope", "user:read:chat")
		result.Set("expires_in", "3600")
	} else {
		http.Error(w, "invalid decision", 400)
		return
	}
	separator := "#"
	if q.Get("decision") == "deny" { separator = "?" }
	http.Redirect(w, r, redirect+separator+result.Encode(), http.StatusFound)
}
func (m *simulator) validation(w http.ResponseWriter, r *http.Request) {
	if !cors(w, r) {
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method", 405)
		return
	}
	v, ok := m.validate(r.Header.Get("Authorization"), "OAuth")
	if !ok {
		reply(w, 401, map[string]any{"status": 401})
		return
	}
	reply(w, 200, map[string]any{"client_id": client, "user_id": v.user, "scopes": v.scopes, "expires_in": int(time.Until(v.expiry).Seconds())})
}
func (m *simulator) subscribe(w http.ResponseWriter, r *http.Request) {
	if !cors(w, r) {
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method", 405)
		return
	}
	v, ok := m.validate(r.Header.Get("Authorization"), "Bearer")
	if !ok || r.Header.Get("Client-Id") != client {
		reply(w, 401, map[string]any{"status": 401})
		return
	}
	var b struct {
		Type      string            `json:"type"`
		Version   string            `json:"version"`
		Condition map[string]string `json:"condition"`
		Transport map[string]string `json:"transport"`
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 4096))
	if dec.Decode(&b) != nil || b.Type != "channel.chat.message" || b.Version != "1" || b.Condition["broadcaster_user_id"] != "synthetic-channel" || b.Condition["user_id"] != v.user || b.Transport["method"] != "websocket" {
		reply(w, 400, map[string]any{"status": 400})
		return
	}
	m.mu.Lock()
	sess, exists := m.sessions[b.Transport["session_id"]]
	if !exists || sess.sub != nil {
		m.mu.Unlock()
		reply(w, 409, map[string]any{"status": 409})
		return
	}
	sub := &subscription{ID: random(16), Status: "enabled", Type: b.Type, Version: b.Version, Condition: b.Condition, Transport: b.Transport}
	sess.sub = sub
	m.mu.Unlock()
	reply(w, 202, map[string]any{"data": []*subscription{sub}})
}
func (m *simulator) websocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" || r.Header.Get("Origin") == origin }}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c.SetReadLimit(32768)
	sess := &session{id: random(12), conn: c}
	m.mu.Lock()
	if len(m.sessions) >= 32 {
		m.mu.Unlock()
		_ = c.Close()
		return
	}
	if key := r.URL.Query().Get("reconnect"); key != "" {
		oldID, ok := m.migrations[key]
		old := m.sessions[oldID]
		if !ok || old == nil || old.sub == nil {
			m.mu.Unlock()
			_ = c.Close()
			return
		}
		delete(m.migrations, key)
		sess.sub = old.sub
		old.sub = nil
		sess.sub.Transport = map[string]string{"method": "websocket", "session_id": sess.id}
	}
	m.sessions[sess.id] = sess
	m.mu.Unlock()
	_ = sess.send(envelope("session_welcome", map[string]any{"session": map[string]any{"id": sess.id, "keepalive_timeout_seconds": 10, "status": "connected"}}))
	stop := make(chan struct{})
	go func() {
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tick.C:
				if sess.send(envelope("session_keepalive", map[string]any{})) != nil {
					return
				}
			}
		}
	}()
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			break
		}
	}
	close(stop)
	m.mu.Lock()
	delete(m.sessions, sess.id)
	for k, id := range m.migrations {
		if id == sess.id {
			delete(m.migrations, k)
		}
	}
	m.mu.Unlock()
	_ = c.Close()
}
func (m *simulator) control(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "" || r.Header.Get("X-Mock-Control") != "synthetic-only" {
		http.Error(w, "forbidden", 403)
		return
	}
	if r.Method == "GET" {
		m.mu.Lock()
		list := []subscription{}
		for _, s := range m.sessions {
			if s.sub != nil {
				list = append(list, *s.sub)
			}
		}
		m.mu.Unlock()
		reply(w, 200, map[string]any{"data": list})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method", 405)
		return
	}
	var b struct {
		Action         string `json:"action"`
		Session        string `json:"session"`
		Text           string `json:"text"`
		MessageID      string `json:"message_id"`
		NotificationID string `json:"notification_id"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&b) != nil {
		http.Error(w, "invalid", 400)
		return
	}
	m.mu.Lock()
	sess := m.sessions[b.Session]
	if sess == nil || sess.sub == nil {
		m.mu.Unlock()
		http.Error(w, "session", 404)
		return
	}
	sub := *sess.sub
	if b.Action == "reconnect" {
		if len(m.migrations) >= 32 {
			m.mu.Unlock()
			http.Error(w, "mock capacity", 503)
			return
		}
		key := random(16)
		m.migrations[key] = sess.id
		m.mu.Unlock()
		msg := envelope("session_reconnect", map[string]any{"session": map[string]any{"reconnect_url": "ws://127.0.0.1:8091/ws?reconnect=" + key}})
		if sess.send(msg) != nil {
			http.Error(w, "send", 500)
			return
		}
		reply(w, 200, map[string]any{"ok": true})
		return
	}
	m.mu.Unlock()
	if b.Action == "disconnect" {
		sess.write.Lock()
		_ = sess.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4006, "simulated"), time.Now().Add(time.Second))
		sess.write.Unlock()
		_ = sess.conn.Close()
		reply(w, 200, map[string]any{"ok": true})
		return
	}
	if b.Action != "chat" || len(b.Text) > 100 || len(b.MessageID) == 0 || len(b.MessageID) > 128 || len(b.NotificationID) == 0 || len(b.NotificationID) > 128 {
		http.Error(w, "invalid", 400)
		return
	}
	msg := envelope("notification", map[string]any{"subscription": sub, "event": map[string]any{"broadcaster_user_id": "synthetic-channel", "chatter_user_id": "viewer", "message_id": b.MessageID, "message": map[string]string{"text": b.Text}}})
	meta := msg["metadata"].(map[string]string)
	meta["message_id"] = b.NotificationID
	meta["subscription_type"] = "channel.chat.message"
	if sess.send(msg) != nil {
		http.Error(w, "send", 500)
		return
	}
	reply(w, 200, map[string]any{"ok": true})
}
func main() {
	m := &simulator{tokens: map[string]token{}, sessions: map[string]*session{}, migrations: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/authorize", m.authorize)
	mux.HandleFunc("/oauth2/validate", m.validation)
	mux.HandleFunc("/helix/eventsub/subscriptions", m.subscribe)
	mux.HandleFunc("/ws", m.websocket)
	mux.HandleFunc("/__mock/control", m.control)
	srv := &http.Server{Addr: "127.0.0.1:8091", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Print("simulator start failed")
			os.Exit(1)
		}
	}()
	fmt.Println("Local OAuth/EventSub simulator: 127.0.0.1:8091")
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt)
	<-ch
	_ = srv.Close()
}
