#pragma once
#include <stdint.h>
#include <string.h>

// Local gate consumption prevents a response to an earlier poll from rearming
// the lever before its event reaches the backend. Events are never retried.
class InputGate {
 public:
  char gate[81], pending[81];
  uint32_t updatedAt, pulledAt;
  InputGate() {gate[0]=pending[0]=consumed[0]=0; updatedAt=pulledAt=0;}
  void update(const char *value, uint32_t now) {
    if (strlen(value)>80) {clear(); return;}
    strcpy(gate, strcmp(value,consumed) ? value : ""); updatedAt=now;
  }
  bool pull(uint32_t now) {
    if (!gate[0] || pending[0] || (uint32_t)(now-updatedAt)>=1000) return false;
    strcpy(pending,gate); strcpy(consumed,gate); gate[0]=0; pulledAt=now; return true;
  }
  bool hasPending(uint32_t now) {return pending[0] && (uint32_t)(now-pulledAt)<750;}
  void sent() {pending[0]=0;}
  void clear() {gate[0]=pending[0]=0;} // Keep consumed across reconnects.
 private:
  char consumed[81];
};
