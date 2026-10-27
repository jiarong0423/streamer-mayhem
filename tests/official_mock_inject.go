// Sends a synthetic chat payload to the official CLI's local-only mock RPC.
package main

import (
    "encoding/json"
    "fmt"
    "net/rpc"
    "os"
    "strings"
)

type args struct { RPCName string; Body string; Variables map[string]string }
type response struct { ResponseCode int; DetailedInfo string }

func main() {
    if len(os.Args) != 4 || len(os.Args[1]) > 100 || len(os.Args[2]) > 128 || len(os.Args[3]) > 128 {
        fmt.Fprintln(os.Stderr, "usage: official_mock_inject <text> <message-id> <actor-id>"); os.Exit(2)
    }
    body := map[string]any{
        "subscription": map[string]any{"type":"channel.chat.message", "version":"1"},
        "event": map[string]any{"broadcaster_user_id":"synthetic-channel", "chatter_user_id":os.Args[3],
            "message_id":os.Args[2], "message":map[string]string{"text":os.Args[1]}},
    }
    encoded, err := json.Marshal(body); if err != nil { fmt.Fprintln(os.Stderr, "encode failed"); os.Exit(1) }
    client, err := rpc.DialHTTP("tcp", "127.0.0.1:44747"); if err != nil { fmt.Fprintln(os.Stderr, "local mock RPC unavailable"); os.Exit(1) }
    defer client.Close()
    var reply response
    err = client.Call("RPCHandler.ExecuteGenericRPC", args{RPCName:"EventSubWebSocketForwardEvent", Body:string(encoded), Variables:map[string]string{}}, &reply)
    if err != nil || reply.ResponseCode != 0 { fmt.Fprintln(os.Stderr, "mock RPC rejected event", strings.ReplaceAll(reply.DetailedInfo, "\n", " ")); os.Exit(1) }
}
