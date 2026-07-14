// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TRC-721 receiver hook — a contract must implement this (and return
/// the selector) to accept cards delivered via `safeTransferFrom`.
interface ITRC721Receiver {
    function onTRC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}
