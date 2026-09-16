/**
 * AIS identity persistence is kept separate from provider selection and
 * normalization. Connectors can import the provider-neutral lookup contract
 * without depending on route code.
 */
export {
  AIS_IDENTITY_IDENTIFIER_TYPES,
  AisIdentityError,
  deleteAisIdentity,
  getVerifiedAisIdentity,
  listAisIdentities,
  registerAisIdentity,
  updateAisIdentity,
  type AisIdentityCollection,
  type AisIdentityConflict,
  type AisIdentityEvidence,
  type AisIdentityIdentifierType,
  type AisIdentityMapping,
  type RegisterAisIdentityInput,
  type UpdateAisIdentityInput,
} from "../aisIdentity";
