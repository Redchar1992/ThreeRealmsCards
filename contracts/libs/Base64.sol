// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Base64 encoder, assembly fast path.
/// @notice Started life as an analyzer-friendly byte loop; P10 measured the
/// double-encoded tokenURI (JSON wrapping an SVG) at ~4.07M gas, which blows
/// the CPU budget public TRON nodes grant constant calls — TronGrid answered
/// `OutOfTimeException` instead of metadata. This is the classic
/// OpenZeppelin-shaped assembly encoder, rewritten in-repo to keep the
/// zero-dependency rule; the loop original lives in git history. Safety net:
/// differential tests against Node's encoder (RFC 4648 vectors + seeded
/// random blobs) ran unchanged across the swap.
library Base64 {
    string internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";

        string memory table = TABLE;
        // 4 output chars for every 3 input bytes, rounded up
        string memory result = new string(4 * ((data.length + 2) / 3));

        assembly {
            // table content starts at table+32; with tablePtr = table+1 the
            // char at index i lands in the LOW byte of mload(tablePtr + i),
            // which is exactly what mstore8 stores
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            let dataPtr := data
            let endPtr := add(data, mload(data))

            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                // low 3 bytes of this word are the current input chunk
                let input := mload(dataPtr)

                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }

            // '=' padding for the 1- and 2-byte tails
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 {
                mstore8(sub(resultPtr, 1), 0x3d)
            }
        }

        return result;
    }
}
