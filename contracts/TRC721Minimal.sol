// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Minimal TRC721-style NFT.
/// @notice Core ownership/approval/transfer surface with owner-gated mint;
/// self-contained so it compiles in the browser without external imports.
contract TRC721Minimal {
    string public name;
    string public symbol;
    address public contractOwner;
    uint256 public nextTokenId;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed holder, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed holder, address indexed operator, bool approved);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        contractOwner = msg.sender;
    }

    function mint(address to) public returns (uint256 tokenId) {
        require(msg.sender == contractOwner, "TRC721: caller is not the owner");
        require(to != address(0), "TRC721: mint to the zero address");
        tokenId = ++nextTokenId;
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function approve(address approved, uint256 tokenId) public {
        address holder = ownerOf[tokenId];
        require(msg.sender == holder || isApprovedForAll[holder][msg.sender], "TRC721: not authorized");
        getApproved[tokenId] = approved;
        emit Approval(holder, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address holder = ownerOf[tokenId];
        require(holder == from, "TRC721: from is not the token owner");
        require(to != address(0), "TRC721: transfer to the zero address");
        require(
            msg.sender == holder || msg.sender == getApproved[tokenId] || isApprovedForAll[holder][msg.sender],
            "TRC721: not authorized"
        );
        delete getApproved[tokenId];
        ownerOf[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        emit Transfer(from, to, tokenId);
    }
}
