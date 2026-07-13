// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Loop-based base64 encoder (no assembly, analyzer-friendly).
library Base64 {
    bytes internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory table = TABLE;
        bytes memory result = new bytes(4 * ((data.length + 2) / 3));
        uint256 di = 0;
        uint256 ri = 0;
        while (di + 3 <= data.length) {
            uint256 chunk = (uint256(uint8(data[di])) << 16) | (uint256(uint8(data[di + 1])) << 8) | uint256(uint8(data[di + 2]));
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = table[(chunk >> 6) & 63];
            result[ri++] = table[chunk & 63];
            di += 3;
        }
        uint256 rem = data.length - di;
        if (rem == 1) {
            uint256 chunk = uint256(uint8(data[di])) << 16;
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = "=";
            result[ri] = "=";
        } else if (rem == 2) {
            uint256 chunk = (uint256(uint8(data[di])) << 16) | (uint256(uint8(data[di + 1])) << 8);
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = table[(chunk >> 6) & 63];
            result[ri] = "=";
        }
        return string(result);
    }
}
