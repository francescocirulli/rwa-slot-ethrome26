import {loadArkivConfig} from './config';
import {createArkivStore} from './store';
import {createSeasonService} from './service';
import {loadSlotConfig} from '../slot/config';
import {createSlotReader} from '../slot/reader';
const state = globalThis as typeof globalThis & {arkivSeasons?:ReturnType<typeof createSeasonService>;arkivInvalid?:boolean};
export function getSeasonService() {
  if(state.arkivSeasons) return state.arkivSeasons;
  if(state.arkivInvalid) throw new Error('Season configuration unavailable');
  try {
    const config = loadArkivConfig();
    if(!config) return null;
    const slot = loadSlotConfig();
    if(!slot || config.baseFromBlock < slot.deploymentBlock) throw new Error('Invalid source contract configuration');
    const reader = createSlotReader(slot);
    state.arkivSeasons = createSeasonService(config,createArkivStore(config,reader),reader);
    return state.arkivSeasons;
  } catch {state.arkivInvalid=true;throw new Error('Season configuration unavailable');}
}
