// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TRC-165 interface detection — marketplaces probe this to recognize
/// the contract as a TRC-721.
interface ITRC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
