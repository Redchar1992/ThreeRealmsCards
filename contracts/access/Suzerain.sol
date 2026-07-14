// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title 主公 access control — Ownable with local color, kept abstract so the
/// inheriting contract must chain the constructor.
/// @notice Handover is TWO-STEP: the suzerain names an heir apparent, and only
/// the heir's own acceptSuzerainty() moves the throne — a typoed address can
/// designate a wrong heir, but can no longer brick the realm. For production
/// custody, point `suzerain` at a TRON multisig account (native account
/// permissions), no extra contract needed.
abstract contract Suzerain {
    error NotSuzerain(address intruder);
    error NotHeirApparent(address intruder);
    error ZeroSuzerain();

    event HeirDesignated(address indexed suzerain, address indexed heir);
    event SuzeraintyPassed(address indexed from, address indexed to);

    address public suzerain;
    address public heirApparent;
    uint64 public immutable enthronedAt;

    modifier onlySuzerain() {
        if (msg.sender != suzerain) revert NotSuzerain(msg.sender);
        _;
    }

    constructor(address firstLord) {
        if (firstLord == address(0)) revert ZeroSuzerain();
        suzerain = firstLord;
        enthronedAt = uint64(block.timestamp);
        emit SuzeraintyPassed(address(0), firstLord);
    }

    /// @notice Step 1: name an heir apparent. Passing address(0) cancels a
    /// pending designation. Nothing changes hands yet.
    function passSuzerainty(address heir) public virtual onlySuzerain {
        heirApparent = heir;
        emit HeirDesignated(suzerain, heir);
    }

    /// @notice Step 2: the heir apparent claims the throne.
    function acceptSuzerainty() public virtual {
        if (msg.sender != heirApparent) revert NotHeirApparent(msg.sender);
        address previous = suzerain;
        suzerain = msg.sender;
        heirApparent = address(0);
        emit SuzeraintyPassed(previous, msg.sender);
    }
}
