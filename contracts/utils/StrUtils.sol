// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal string helpers. Small on purpose — the import graph (this
/// file is imported under an ALIAS elsewhere) matters as much as the code.
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

    /// @notice Escape a string for embedding inside a JSON string literal:
    /// `"` and `\` get backslash-escaped, control chars become \u00XX.
    /// Anything else (incl. multi-byte UTF-8) passes through untouched.
    function escapeJson(string memory value) internal pure returns (string memory) {
        bytes memory raw = bytes(value);
        uint256 extra;
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c == '"' || c == "\\") extra += 1;
            else if (uint8(c) < 0x20) extra += 5;
        }
        if (extra == 0) return value;
        bytes memory escaped = new bytes(raw.length + extra);
        uint256 n;
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c == '"' || c == "\\") {
                escaped[n++] = "\\";
                escaped[n++] = c;
            } else if (uint8(c) < 0x20) {
                escaped[n++] = "\\";
                escaped[n++] = "u";
                escaped[n++] = "0";
                escaped[n++] = "0";
                escaped[n++] = _hexChar(uint8(c) >> 4);
                escaped[n++] = _hexChar(uint8(c) & 0x0f);
            } else {
                escaped[n++] = c;
            }
        }
        return string(escaped);
    }

    function _hexChar(uint8 nibble) private pure returns (bytes1) {
        return nibble < 10 ? bytes1(nibble + 0x30) : bytes1(nibble + 0x57); // 0-9 / a-f
    }
}
