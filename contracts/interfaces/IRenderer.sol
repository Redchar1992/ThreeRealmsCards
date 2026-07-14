// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Card } from "../types/CardTypes.sol";

/// @title Pluggable card-art renderer — turns a card into a self-contained
/// image URI (e.g. data:image/svg+xml;base64,…). Implementations should be
/// stateless; the card contract passes the full Card so renderers never need
/// storage access.
interface IRenderer {
    function imageURI(Card memory card, uint256 tokenId) external view returns (string memory);
}
