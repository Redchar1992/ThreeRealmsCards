// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ForgeLite — the minimal slice of forge-std this repo needs.
/// @notice Written in-repo instead of vendoring forge-std: the npm mirror is
/// years stale and a git submodule buys forty files where we use six
/// functions. Zero external dependencies stays true even for the test
/// harness. Conventions matched against the foundry invariant runner:
/// `targetContracts()` / `targetSelectors()` getters, `invariant_*` test
/// methods that revert on violation, `setUp()` before the campaign.

/// @dev The subset of cheatcodes the handler and invariants use.
interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function label(address account, string calldata name) external;
}

/// @dev address(uint160(uint256(keccak256("hevm cheat code"))))
address constant VM_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

abstract contract ForgeLite {
    Vm internal constant vm = Vm(VM_ADDRESS);

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    address[] private _targetedContracts;
    FuzzSelector[] private _targetedSelectors;

    function targetContract(address newTarget) internal {
        _targetedContracts.push(newTarget);
    }

    function targetSelector(FuzzSelector memory newSelector) internal {
        _targetedSelectors.push(newSelector);
    }

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function targetSelectors() public view returns (FuzzSelector[] memory) {
        return _targetedSelectors;
    }

    /// @dev forge's bound: clamp a fuzzed word into [min, max], both ends
    /// inclusive; the full-range case falls through untouched.
    function bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        require(min <= max, "ForgeLite: bound(min > max)");
        uint256 size;
        unchecked { size = max - min + 1; } // 0 means the full 2^256 range
        if (size == 0) return x;
        return min + (x % size);
    }

    function makeAddr(string memory name) internal returns (address addr) {
        addr = address(uint160(uint256(keccak256(bytes(name)))));
        vm.label(addr, name);
    }
}
