// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title 主公 access control — Ownable with local color, kept abstract so the
/// inheriting contract must chain the constructor.
abstract contract Suzerain {
    error NotSuzerain(address intruder);
    error ZeroSuzerain();

    event SuzeraintyPassed(address indexed from, address indexed to);

    address public suzerain;
    uint64 public immutable enthronedAt;

    modifier onlySuzerain() {
        if (msg.sender != suzerain) revert NotSuzerain(msg.sender);
        _;
    }

    constructor(address firstLord) {
        if (firstLord == address(0)) revert ZeroSuzerain();
        suzerain = firstLord;
        enthronedAt = uint64(block.timestamp);
    }

    function passSuzerainty(address heir) public virtual onlySuzerain {
        if (heir == address(0)) revert ZeroSuzerain();
        emit SuzeraintyPassed(suzerain, heir);
        suzerain = heir;
    }
}
