// Relay contract with fake requests (no sockets): the Host gate, the Origin rule and the body cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayRelay} from '../scripts/overlay-relay.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {makeOverlayState} from '../dist/overlay_protocol.mjs';
import {fakeRequest,fakeResponse} from './helpers/relay_fakes.mjs';

const session='c'.repeat(32);
const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
const sample=(sequence,extra={})=>makeOverlayState({session,sequence,geometry,snapshot:{mode:'PLAYING',attacks:[],score:10,hp:90,...extra},sourcePoint:{x:.5,y:.5,visibility:1}});

function post(relay,{host,origin=`http://${host}`,body,contentType}){
  const req=fakeRequest({host,origin,body,contentType}),res=fakeResponse();
  const handled=relay.handle(req,res);req.send();return {handled,res};
}

test('F8 relay accepts Host 127.0.0.1:<port> and localhost:<port> for POST',()=>{
  const relay=createOverlayRelay();
  try{
    assert.equal(post(relay,{host:'127.0.0.1:4173',body:sample(1)}).res.status,204);
    assert.equal(post(relay,{host:'localhost:4173',body:sample(2)}).res.status,204);
  }finally{relay.close();}
});

test('F8 relay accepts Host localhost for the event stream and still validates the session',()=>{
  const relay=createOverlayRelay();
  try{
    for(const host of ['127.0.0.1:4173','localhost:4173']){
      const res=fakeResponse(),req=fakeRequest({method:'GET',url:`/__overlay/events?session=${session}`,host,contentType:null});
      assert.equal(relay.handle(req,res),true);assert.equal(res.status,200,host);req.emit('close');
    }
    const bad=fakeResponse();relay.handle(fakeRequest({method:'GET',url:'/__overlay/events?session=zz',host:'localhost:4173',contentType:null}),bad);
    assert.equal(bad.status,400);
  }finally{relay.close();}
});

test('F8 relay rejects foreign, look-alike, portless and missing hosts',()=>{
  const relay=createOverlayRelay();
  try{
    let n=0;
    for(const host of ['evil.example:4173','127.0.0.1.evil.com:4173','localhost.evil.com:4173','evil.com/localhost:4173','localhost','127.0.0.1','[::1]:4173','LOCALHOST:4173',' localhost:4173','localhost:4173 ','localhost:abc',undefined]){
      const req=fakeRequest({host,origin:`http://${host}`,body:sample(100+n++)}),res=fakeResponse();
      assert.equal(relay.handle(req,res),true);req.send();assert.equal(res.status,403,String(host));
    }
    const ev=fakeResponse();relay.handle(fakeRequest({method:'GET',url:`/__overlay/events?session=${session}`,host:'evil.example:4173',contentType:null}),ev);assert.equal(ev.status,403);
  }finally{relay.close();}
});

test('F8 Origin must equal http://<the same Host>: localhost page cannot post as 127.0.0.1 and vice versa',()=>{
  const relay=createOverlayRelay();
  try{
    assert.equal(post(relay,{host:'localhost:4173',origin:'http://127.0.0.1:4173',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'127.0.0.1:4173',origin:'http://localhost:4173',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'localhost:4173',origin:'http://localhost:4174',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'localhost:4173',origin:'https://localhost:4173',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'localhost:4173',origin:'http://example.invalid',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'localhost:4173',contentType:'text/plain',body:sample(1)}).res.status,403);
    assert.equal(post(relay,{host:'localhost:4173',body:sample(1)}).res.status,204);
  }finally{relay.close();}
});

test('F8 non-overlay paths are not handled by the relay',()=>{
  const relay=createOverlayRelay();
  try{assert.equal(relay.handle(fakeRequest({method:'GET',url:'/index.html',host:'localhost:4173',contentType:null}),fakeResponse()),false);}finally{relay.close();}
});
