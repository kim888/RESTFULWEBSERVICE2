/*
 * Copyright 2010-2017 Restlet S.A.S. All rights reserved.
 * Restlet is registered trademark of Restlet S.A.S.
 */

(() => {
  'use strict';

  const crypto = window.crypto;
  const { _ } = window.RESTLET;

  const CRYPTO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-~'; // DON'T ADD CHARACTERS THAT GET URL-ENCODED IN THE ALPHABET. WOULD BREAK REGEXES
  const CRYPTO_ALPHABET_SIZE = _.size(CRYPTO_ALPHABET);

  const generateCryptoSecureRandomString = (size) => {
    const array = crypto.getRandomValues(new Uint32Array(size));
    return _(array)
      .map((number) => CRYPTO_ALPHABET.charAt(number % CRYPTO_ALPHABET_SIZE))
      .join('');
  };

  const silentAuthentication = async (domain, clientId) => {
    const state = generateCryptoSecureRandomString(15);
    const nonce = generateCryptoSecureRandomString(15);

    const queryParameters = {
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1.xip.io:8080/authentication/samples/',
      audience: `https://${domain}/userinfo`,
      scope: 'openid profile email',
      response_type: 'token id_token',
      response_mode: 'web_message',
      prompt: 'none',
      state,
      nonce
    };

    const queryString = _(queryParameters)
      .map((queryParameterValue, queryParameterName) =>
        `${encodeURIComponent(queryParameterName)}=${encodeURIComponent(queryParameterValue)}`)
      .join('&');

    const url = `https://${domain}/authorize?${queryString}`;
    const options = {
      method: 'GET',
      credentials: 'include'
    };

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(response.body);
    }

    const payloadAsText = await response.text();
    const idTokenRegex = /"id_token":"([^"]+)"/g; // https://regex101.com/r/QRe0OS/2
    const idTokenSearchResult = idTokenRegex.exec(payloadAsText);

    if (!idTokenSearchResult) {
      return null;
    }

    const responseIdToken = idTokenSearchResult[ 1 ];
    const responseState = /"state":"([^"]+)"/g.exec(payloadAsText)[ 1 ]; // https://regex101.com/r/EiDCDv/2

    if (state !== responseState) {
      throw new Error(`Forgery avoided!!!!! States don't match. Expected: ${state} but got ${responseState}`);
    }

    return {
      jwtToken: responseIdToken,
      domain: domain,
      clientId: clientId,
      signup: false
    };
  };

  const logout = (auth0Domain) => {
    const options = {
      method: 'GET',
      credentials: 'include'
    };


    return fetch(`https://${auth0Domain}/v2/logout`, options)
      .then((response) => {
        if (response.ok) {
          return;
        }

        throw Error('Logout failed');
      });
  };

  window.RESTLET.authService = { silentAuthentication, logout };
})();
