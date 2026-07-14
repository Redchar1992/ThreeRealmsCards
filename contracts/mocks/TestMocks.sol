// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC721 } from "../interfaces/ITRC721.sol";
import { ITRC721Receiver } from "../interfaces/ITRC721Receiver.sol";
import { IRenderer } from "../interfaces/IRenderer.sol";
import { Card } from "../types/CardTypes.sol";
import { Base64 } from "../libs/Base64.sol";
import { Str } from "../utils/StrUtils.sol";
import { Suzerain } from "../access/Suzerain.sol";
import { CardBazaar } from "../CardBazaar.sol";

/// @dev Test-only doubles for the Hardhat suite — not part of the deployable
/// surface and excluded from flatten/verification flows.

/// @dev Configurable receiver: returns a chosen magic value, or reverts.
contract TRC721ReceiverMock is ITRC721Receiver {
    bytes4 private immutable _retval;
    bool private immutable _rejects;

    event Received(address operator, address from, uint256 tokenId, bytes data);

    constructor(bytes4 retval, bool rejects) {
        _retval = retval;
        _rejects = rejects;
    }

    function onTRC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(!_rejects, "TRC721ReceiverMock: rejecting");
        emit Received(operator, from, tokenId, data);
        return _retval;
    }
}

/// @dev Concrete Suzerain so the abstract base's guards are testable alone.
contract SuzerainMock is Suzerain {
    constructor(address firstLord) Suzerain(firstLord) {}
}

/// @dev A "card contract" whose ownerOf reverts require-string style, to
/// exercise the pavilion's catch Error(string) branch.
contract StringRevertingCardsMock {
    function ownerOf(uint256) external pure returns (address) {
        revert("legacy string revert");
    }
}

/// @dev Has code but no onTRC721Received — safe transfers here must fail.
contract NonReceiverMock {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

/// @dev A renderer that always reverts — tokenURI must degrade gracefully.
contract RevertingRendererMock is IRenderer {
    function imageURI(Card memory, uint256) external pure override returns (string memory) {
        revert("renderer down");
    }
}

/// @dev A renderer that tries to break out of the metadata JSON.
contract EvilRendererMock is IRenderer {
    function imageURI(Card memory, uint256) external pure override returns (string memory) {
        return '"},"pwn":true,"x":"';
    }
}

/// @dev A contract seller for the bazaar with a hostile receive():
/// mode 0 attempts a reentrant withdraw() when the TRX arrives,
/// mode 1 flatly refuses TRX (proceeds-transfer failure path).
contract HostileSellerMock {
    CardBazaar public immutable bazaar;
    uint8 public immutable mode;
    bool public innerWithdrawSucceeded;
    uint256 public receiveCount;

    constructor(CardBazaar bazaar_, uint8 mode_) {
        bazaar = bazaar_;
        mode = mode_;
    }

    function approveBazaar(ITRC721 cards, uint256 tokenId) external {
        cards.approve(address(bazaar), tokenId);
    }

    function listCard(uint256 tokenId, uint256 price) external {
        bazaar.list(tokenId, price);
    }

    function doWithdraw() external {
        bazaar.withdraw();
    }

    receive() external payable {
        receiveCount++;
        if (mode == 1) revert("no thanks");
        // mode 0: try to drain again mid-payout — CEI must leave nothing
        try bazaar.withdraw() {
            innerWithdrawSucceeded = true;
        } catch {}
    }
}

/// @dev Exposes internal library functions for differential testing.
contract LibHarness {
    // redeclared so the fragment is present in this contract's ABI for
    // matchers, same selector as the file-level error in CardTypes.sol
    error StatOutOfRange(uint8 value);

    function base64(bytes calldata data) external pure returns (string memory) {
        return Base64.encode(data);
    }

    function toDecimalString(uint256 value) external pure returns (string memory) {
        return Str.toString(value);
    }

    function escapeJson(string calldata value) external pure returns (string memory) {
        return Str.escapeJson(value);
    }

    function escapeXml(string calldata value) external pure returns (string memory) {
        return Str.escapeXml(value);
    }

    function strEqual(string calldata a, string calldata b) external pure returns (bool) {
        return Str.equal(a, b);
    }
}
