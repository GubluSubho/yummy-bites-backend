const { createRemoteJWKSet, jwtVerify } = require('jose');

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// FIREBASE_PROJECT_ID can hold one project, or several separated by commas (useful while moving to a new project)
function projectIds() {
  return String(process.env.FIREBASE_PROJECT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function verifyFirebaseToken(idToken) {
  const ids = projectIds();
  if (ids.length === 0) throw new Error('Server is missing FIREBASE_PROJECT_ID');

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ids.map((id) => 'https://securetoken.google.com/' + id),
    audience: ids,
    algorithms: ['RS256'],
    clockTolerance: 10,
  });
  return payload;
}

module.exports = { verifyFirebaseToken };
