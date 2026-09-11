'use client';
import {getIdentityToken} from '@privy-io/react-auth';
export async function walletAuthorizationHeaders() {
  const token=await getIdentityToken();
  if(!token)throw new Error('Abilita “Return user data in an identity token” in Privy → User management → Authentication → Advanced, poi accedi di nuovo.');
  return {'Privy-Id-Token':token};
}
