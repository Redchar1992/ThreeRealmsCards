// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Core TRC-721 surface (transfer/approval), events included.
interface ITRC721 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed holder, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed holder, address indexed operator, bool approved);

    function balanceOf(address holder) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function approve(address approved, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address holder, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
}
