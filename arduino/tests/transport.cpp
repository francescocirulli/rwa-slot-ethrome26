#include "../slot_controller/HttpResponse.h"
#include "../slot_controller/InputGate.h"
#include <assert.h>
#include <string>
#include <stdio.h>
static HttpResponse parse(const std::string &text) {HttpResponse r;for(char c:text) r.feed(c);return r;}
int main() {
  HttpResponse r=parse("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}");
  assert(r.done&&!r.failed&&!r.closeConnection&&r.status==200&&!strcmp(r.body,"{}"));
  r=parse("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;ext=yes\r\n{\r\n1\r\n}\r\n0\r\nX-Trailer: safe\r\n\r\n");
  assert(r.done&&!r.failed&&!strcmp(r.body,"{}"));
  r=parse("HTTP/1.0 401 Unauthorized\r\n\r\n{}");assert(!r.done);r.end();assert(r.done&&r.closeConnection&&r.status==401);
  r=parse("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n{}");r.end();assert(r.failed&&!r.done);
  r=parse("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");assert(r.done&&!r.failed);
  const char *bad[]={
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 99999999999999999999999\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nffffffff\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx!",
    "HTTP/1.1 200 OK\n",
    "HTTP/1.1 101 Switching Protocols\r\n",
    "HTTP/1.1 2000 OK\r\n",
    "HTTP/1.1 20\r\n"
  };
  for(auto text:bad)assert(parse(text).failed);
  assert(parse("HTTP/1.1 200 OK\r\nX-Large: "+std::string(800,'x')+"\r\n").failed);
  assert(parse("HTTP/1.0 200 OK\r\n\r\n"+std::string(1600,'x')).failed);
  r.reset();assert(!r.done&&!r.failed&&r.size==0&&r.status==0);
  InputGate g;assert(!g.pull(100));g.update("turn-1",100);assert(g.pull(200));assert(g.hasPending(210));assert(!g.pull(220));
  g.update("turn-1",250);assert(!g.pull(260)); // reply for previous poll cannot rearm
  g.sent();g.update("turn-1",300);assert(!g.pull(310));
  g.clear();g.update("turn-1",400);assert(!g.pull(410)); // reconnect cannot replay
  g.update("turn-2",500);assert(g.pull(510));assert(!g.hasPending(1260));g.sent();
  g.update("turn-3",1500);assert(!g.pull(2500)); // old readiness
  g.update("turn-4",UINT32_MAX-10);assert(g.pull(20));assert(g.hasPending(30)); // millis wrap
  puts("HTTP framing and physical input gates: passed");
}
