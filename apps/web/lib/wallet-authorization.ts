import type {Identity,WalletService} from './types';
import {SlotError} from './slot/errors';
export async function walletAuthorizationToken(request:Request,user:Identity,service:WalletService) {
  const token=request.headers.get('privy-id-token');
  if(!token||token.length>32000)throw new SlotError('IdentityTokenRequired','Abilita “Return user data in an identity token” nel dashboard Privy e accedi di nuovo.',409);
  if(!service.verifyIdentityToken)throw new SlotError('IdentityTokenRequired','Verifica identity token non disponibile.',503);
  try{await service.verifyIdentityToken(token,user.userId);}catch{throw new SlotError('WalletIdentity','L’autorizzazione wallet non corrisponde al tuo account. Accedi di nuovo.',401);}
  return token;
}
