const { createRemoteJWKSet, jwtVerify } = require('jose');

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyFirebaseToken(idToken) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Server is missing FIREBASE_PROJECT_ID');

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: 'https://securetoken.google.com/' + projectId,
    audience: projectId,
    algorithms: ['RS256'],
    clockTolerance: 10,
  });
  return payload;
}

module.exports = { verifyFirebaseToken };
