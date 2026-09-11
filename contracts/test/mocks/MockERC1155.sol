// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockERC1155 is ERC1155 {
    constructor() ERC1155("ipfs://slot-prize/{id}.json") {}

    function mint(address recipient, uint256 tokenId, uint256 amount) external {
        _mint(recipient, tokenId, amount, "");
    }
}
