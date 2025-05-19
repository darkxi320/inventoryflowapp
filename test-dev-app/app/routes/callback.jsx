// src/routes/shopify/callback.tsx

import { useEffect } from 'react';

export default function ShopifyCallback() {
  useEffect(() => {
    // You can handle the Shopify OAuth code here and exchange it for the access token
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const shop = params.get('shop');
    const state = params.get('state');
    
    if (code && shop && state) {
      // Make a call to your backend to exchange the code for an access token
      fetch('/shopify/callback', {
        method: 'POST',
        body: JSON.stringify({ code, shop, state }),
        headers: { 'Content-Type': 'application/json' },
      })
      .then((response) => response.json())
      .then((data) => {
        console.log('Shopify callback data:', data);
      });
    }
  }, []);

  return (
    <div>
      <h1>Shopify OAuth Callback</h1>
      <p>Handling Shopify OAuth callback...</p>
    </div>
  );
}
