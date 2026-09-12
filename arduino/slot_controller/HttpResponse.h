#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <ctype.h>

// Incremental, bounded HTTP/1.1 framing. No allocation, stream waits or Arduino
// dependency: sensors and LEDs keep running while response bytes arrive.
class HttpResponse {
 public:
  static const size_t BODY_LIMIT = 1536;
  char body[BODY_LIMIT + 1];
  size_t size;
  int status;
  bool done, failed, closeConnection;
  HttpResponse() {reset();}
  void reset() {
    size = 0; status = 0; done = failed = closeConnection = false;
    state = STATUS; used = headerBytes = remaining = 0; hasLength = chunked = false; body[0] = 0;
  }
  void end() {if (!done) {if (state == UNTIL_CLOSE) finish(); else failed = true;}}
  void feed(char c) {
    if (done || failed) return;
    if (state == FIXED || state == CHUNK || state == UNTIL_CLOSE) {
      if (size >= BODY_LIMIT) {failed = true; return;}
      body[size++] = c; body[size] = 0;
      if (state != UNTIL_CLOSE && --remaining == 0) {if (state == FIXED) finish(); else state = CHUNK_CR;}
      return;
    }
    if (state == CHUNK_CR) {if (c != '\r') failed = true; else state = CHUNK_LF; return;}
    if (state == CHUNK_LF) {if (c != '\n') failed = true; else {state = CHUNK_SIZE; used = 0;} return;}
    if (++headerBytes > 4096 || used >= sizeof(line) - 1) {failed = true; return;}
    line[used++] = c;
    if (c != '\n') return;
    if (used < 2 || line[used-2] != '\r') {failed = true; return;}
    line[used-2] = 0; used = 0;
    if (state == STATUS) {
      if (strncmp(line, "HTTP/1.1 ", 9) && strncmp(line, "HTTP/1.0 ", 9)) {failed = true; return;}
      if (strlen(line) < 12 || !isdigit(line[9]) || !isdigit(line[10]) || !isdigit(line[11]) || (line[12] && line[12] != ' ')) {failed = true; return;}
      status = (line[9]-'0')*100 + (line[10]-'0')*10 + line[11]-'0';
      if (status < 200) {failed = true; return;} // Never accept interim/upgrade responses.
      closeConnection = line[7] == '0'; state = HEADERS;
    } else if (state == HEADERS) {
      if (!line[0]) {
        if (chunked && hasLength) {failed = true; return;}
        state = chunked ? CHUNK_SIZE : hasLength ? FIXED : UNTIL_CLOSE;
        if (!chunked && hasLength && remaining == 0) finish();
        if (!chunked && !hasLength) closeConnection = true;
        return;
      }
      for (size_t i=0; line[i]; ++i) line[i] = (char)tolower((unsigned char)line[i]);
      char *colon = strchr(line, ':'); if (!colon) {failed = true; return;} *colon = 0;
      char *value = colon + 1; while (*value == ' ' || *value == '\t') ++value;
      size_t len = strlen(value); while (len && (value[len-1]==' ' || value[len-1]=='\t')) value[--len]=0;
      if (!strcmp(line, "content-length")) {if (hasLength || !number(value, 10, remaining)) failed = true; hasLength = true;}
      if (!strcmp(line, "transfer-encoding")) {if (chunked || strcmp(value,"chunked")) failed = true; chunked = true;}
      if (!strcmp(line, "connection") && strstr(value, "close")) closeConnection = true;
      if (!strcmp(line, "content-encoding") && strcmp(value,"identity")) failed = true;
    } else if (state == CHUNK_SIZE) {
      char *extension = strchr(line, ';'); if (extension) *extension = 0;
      if (!number(line, 16, remaining) || remaining > BODY_LIMIT-size) {failed = true; return;}
      state = remaining ? CHUNK : TRAILERS;
    } else if (state == TRAILERS && !line[0]) finish();
  }
 private:
  enum State {STATUS, HEADERS, FIXED, UNTIL_CLOSE, CHUNK_SIZE, CHUNK, CHUNK_CR, CHUNK_LF, TRAILERS};
  State state;
  char line[768];
  size_t used, headerBytes, remaining;
  bool hasLength, chunked;
  void finish() {done = true; body[size] = 0;}
  bool number(const char *s, unsigned base, size_t &value) {
    if (!*s) return false;
    value = 0;
    while (*s) {
      char c = (char)tolower((unsigned char)*s++);
      unsigned digit = c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : 255;
      if (digit >= base || value > (BODY_LIMIT-digit)/base || digit > BODY_LIMIT) return false;
      value = value * base + digit;
    }
    return value <= BODY_LIMIT;
  }
};
