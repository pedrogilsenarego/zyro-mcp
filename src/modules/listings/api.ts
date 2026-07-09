import type { BackendClient, BackendResult } from "../../backend/client.js";

export interface CreateListingInput {
  title: string;
  rentPrice: number;
  propertyType: string;
  businessType: string;
  listingType?: "supply" | "demand";
}

/** Thin HTTP calls for the listing domain. No business logic. */
export class ListingsApi {
  constructor(private readonly client: BackendClient) {}

  createListing(
    input: CreateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    return this.client.request("/listing/add", {
      method: "POST",
      accessToken,
      body: form,
    });
  }

  deleteListing(
    listingId: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/listing/${encodeURIComponent(listingId)}`,
      { method: "DELETE", accessToken },
    );
  }
}
