import { Page, Banner, Text } from '@shopify/polaris';

export default function ErrorPage() {
  return (
    <Page title="Error">
      <Banner status="critical">
        <Text variant="bodyMd">An error occurred while processing your subscription upgrade. Please try again later.</Text>
      </Banner>
    </Page>
  );
}
