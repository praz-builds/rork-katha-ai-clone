import { adapty } from 'react-native-adapty';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export async function initAdapty() {
  const apiKey = extra.adaptyApiKey;
  if (!apiKey) return;
  try {
    await adapty.activate(apiKey);
  } catch (error) {
    console.warn('Adapty init failed:', error);
  }
}

export async function getPaywallProducts(placementId: string = 'onboarding') {
  try {
    const flow = await adapty.getFlow(placementId);
    const products = await adapty.getPaywallProducts(flow);
    return { flow, products };
  } catch (error) {
    console.warn('Adapty products fetch failed:', error);
    return null;
  }
}

export async function purchaseProduct(productId: string) {
  try {
    const result = await getPaywallProducts();
    const product = result?.products.find(
      (p: { vendorProductId: string }) => p.vendorProductId === productId,
    );
    if (!product) throw new Error('Product not found');
    const purchaseResult = await adapty.makePurchase(product);
    return purchaseResult;
  } catch (error) {
    console.warn('Adapty purchase failed:', error);
    throw error;
  }
}

export async function restorePurchases() {
  try {
    const profile = await adapty.restorePurchases();
    return profile;
  } catch (error) {
    console.warn('Adapty restore failed:', error);
    throw error;
  }
}
