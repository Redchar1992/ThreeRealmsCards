// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal string helpers. Tiny on purpose — the point is the import
/// graph (this file is imported under an ALIAS elsewhere), not the code.
library Str {
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { unchecked { digits++; temp /= 10; } }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                digits -= 1;
                buffer[digits] = bytes1(uint8(48 + (value % 10)));
                value /= 10;
            }
        }
        return string(buffer);
    }

    function equal(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
