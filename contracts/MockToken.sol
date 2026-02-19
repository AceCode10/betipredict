// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @dev A mock ERC20 token for testing purposes
 */
contract MockToken is ERC20, Ownable {
    uint8 private _decimals;
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimalsValue
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        _decimals = _decimalsValue;
    }
    
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
